// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NkapPayouts is ReentrancyGuard {
    // ── Protocol ─────────────────────────────────────────────────────────────────
    address public protocolOwner;
    address public pendingProtocolOwner;
    address public treasury;
    uint16 public feeBps; // ≤ 100 (1 %)
    uint256 public feesAccrued;
    uint256 public platformCount;
    uint256 public batchCount;
    uint256 public totalPaidOut;

    // ── Platform storage ─────────────────────────────────────────────────────────
    struct Platform {
        address owner;
        address pendingOwner;
        string name;
        uint256 pool;
        uint256 totalPaid;
        uint256 batchCount;
    }

    mapping(uint256 => Platform) internal _platforms;

    // ── Operators ────────────────────────────────────────────────────────────────
    // operator => platformId => remaining spending allowance (0 = revoked)
    mapping(address => mapping(uint256 => uint256)) public operators;

    // ── Payout tracking ──────────────────────────────────────────────────────────
    mapping(address => uint256) public owed; // pull-withdrawal credits
    mapping(bytes32 => bool) internal _usedRef; // (platformId, ref) replay guard
    mapping(address => uint256) internal _totalReceivedBy;

    error Unauthorized();
    error ZeroAddress();
    error InvalidFeeBps();
    error PlatformNotFound();
    error InsufficientPool();
    error EmptyBatch();
    error TooManyRecipients();
    error LengthMismatch();
    error ZeroAmount();
    error ZeroShare();
    error DuplicateRef();
    error NothingToClaim();
    error TransferFailed();
    error NoFeesAccrued();
    error ZeroTotal();
    error OverOperatorAllowance();

    event PlatformCreated(uint256 indexed platformId, address indexed owner, string name);
    event OperatorSet(uint256 indexed platformId, address indexed operator, uint256 allowance);
    event PoolFunded(uint256 indexed platformId, address indexed funder, uint256 amount);
    event PoolWithdrawn(uint256 indexed platformId, address indexed to, uint256 amount);
    event BatchPaid(
        uint256 indexed batchId,
        uint256 indexed platformId,
        address indexed operator,
        address[] recipients,
        uint256 total,
        uint256 fee,
        bytes32 ref
    );
    event PayoutSent(uint256 indexed batchId, address indexed recipient, uint256 amount);
    event PayoutCredited(uint256 indexed batchId, address indexed recipient, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeesClaimed(address indexed treasury, uint256 amount);
    event PlatformOwnerTransferStarted(uint256 indexed platformId, address indexed newOwner);
    event PlatformOwnershipTransferred(uint256 indexed platformId, address indexed newOwner);
    event ProtocolOwnerTransferStarted(address indexed newOwner);
    event ProtocolOwnershipTransferred(address indexed newOwner);

    constructor(address treasury_, uint16 feeBps_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > 100) revert InvalidFeeBps();

        protocolOwner = msg.sender;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    modifier onlyProtocolOwner() {
        if (msg.sender != protocolOwner) revert Unauthorized();
        _;
    }

    modifier platformExists(uint256 platformId) {
        if (platformId >= platformCount) revert PlatformNotFound();
        _;
    }

    modifier onlyPlatformOwner(uint256 platformId) {
        if (platformId >= platformCount) revert PlatformNotFound();
        if (_platforms[platformId].owner != msg.sender) revert Unauthorized();
        _;
    }

    function createPlatform(string calldata name) external returns (uint256 platformId) {
        platformId = platformCount;
        platformCount = platformId + 1;

        _platforms[platformId] = Platform({
            owner: msg.sender,
            pendingOwner: address(0),
            name: name,
            pool: 0,
            totalPaid: 0,
            batchCount: 0
        });

        emit PlatformCreated(platformId, msg.sender, name);
    }

    function transferPlatformOwner(uint256 platformId, address newOwner) external onlyPlatformOwner(platformId) {
        if (newOwner == address(0)) revert ZeroAddress();

        _platforms[platformId].pendingOwner = newOwner;
        emit PlatformOwnerTransferStarted(platformId, newOwner);
    }

    function acceptPlatformOwnership(uint256 platformId) external platformExists(platformId) {
        Platform storage platform = _platforms[platformId];
        if (platform.pendingOwner != msg.sender) revert Unauthorized();

        platform.owner = msg.sender;
        platform.pendingOwner = address(0);

        emit PlatformOwnershipTransferred(platformId, msg.sender);
    }

    /// @notice Set or update a spending allowance for an operator on a platform.
    /// @param allowance Total USDC (in wei) the operator may disburse across all batches.
    ///                  Pass 0 to revoke immediately.
    function setOperator(uint256 platformId, address operator, uint256 allowance) external onlyPlatformOwner(platformId) {
        if (operator == address(0)) revert ZeroAddress();

        operators[operator][platformId] = allowance;
        emit OperatorSet(platformId, operator, allowance);
    }

    function fund(uint256 platformId) external payable platformExists(platformId) nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        _platforms[platformId].pool += msg.value;
        emit PoolFunded(platformId, msg.sender, msg.value);
    }

    function withdrawPool(
        uint256 platformId,
        uint256 amount,
        address to
    ) external onlyPlatformOwner(platformId) nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        Platform storage platform = _platforms[platformId];
        if (amount > platform.pool) revert InsufficientPool();

        platform.pool -= amount;

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit PoolWithdrawn(platformId, to, amount);
    }

    function payout(
        uint256 platformId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32 ref
    ) external payable nonReentrant returns (uint256 batchId) {
        Platform storage platform = _platforms[platformId];
        _requirePlatformExists(platformId);

        if (msg.value > 0) {
            platform.pool += msg.value;
            emit PoolFunded(platformId, msg.sender, msg.value);
        }

        uint256 len = recipients.length;
        if (len == 0) revert EmptyBatch();
        if (len > 200) revert TooManyRecipients();
        if (len != amounts.length) revert LengthMismatch();

        bytes32 refKey = keccak256(abi.encode(platformId, ref));
        if (_usedRef[refKey]) revert DuplicateRef();

        uint256 total;
        for (uint256 i = 0; i < len; ++i) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            if (recipient == address(0)) revert ZeroAddress();
            if (amount == 0) revert ZeroAmount();

            total += amount;
        }

        uint256 fee = (total * feeBps) / 10_000;
        uint256 debit = total + fee;
        if (debit > platform.pool) revert InsufficientPool();

        _deductOperatorAllowance(platformId, total, platform.owner);

        platform.pool -= debit;
        feesAccrued += fee;

        batchCount += 1;
        platform.batchCount += 1;
        platform.totalPaid += total;
        totalPaidOut += total;

        _usedRef[refKey] = true;

        batchId = batchCount;

        for (uint256 i = 0; i < len; ++i) {
            _sendPayout(batchId, recipients[i], amounts[i]);
        }

        emit BatchPaid(batchId, platformId, msg.sender, recipients, total, fee, ref);
    }

    function payoutSplit(
        uint256 platformId,
        address[] calldata recipients,
        uint256[] calldata shares,
        uint256 total,
        bytes32 ref
    ) external payable nonReentrant {
        Platform storage platform = _platforms[platformId];
        _requirePlatformExists(platformId);

        if (msg.value > 0) {
            platform.pool += msg.value;
            emit PoolFunded(platformId, msg.sender, msg.value);
        }

        uint256 len = recipients.length;
        if (len == 0) revert EmptyBatch();
        if (len > 200) revert TooManyRecipients();
        if (len != shares.length) revert LengthMismatch();
        if (total == 0) revert ZeroTotal();

        bytes32 refKey = keccak256(abi.encode(platformId, ref));
        if (_usedRef[refKey]) revert DuplicateRef();

        uint256 totalShares;
        for (uint256 i = 0; i < len; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            uint256 share = shares[i];
            if (share == 0) revert ZeroShare();
            totalShares += share;
        }

        uint256 fee = (total * feeBps) / 10_000;
        uint256 debit = total + fee;
        if (debit > platform.pool) revert InsufficientPool();

        _deductOperatorAllowance(platformId, total, platform.owner);

        platform.pool -= debit;
        feesAccrued += fee;

        batchCount += 1;
        platform.batchCount += 1;
        platform.totalPaid += total;
        totalPaidOut += total;

        _usedRef[refKey] = true;

        uint256 batchId = batchCount;
        uint256 distributed;

        for (uint256 i = 0; i + 1 < len; ++i) {
            uint256 amount = (total * shares[i]) / totalShares;
            distributed += amount;
            _sendPayout(batchId, recipients[i], amount);
        }

        uint256 lastAmount = total - distributed;
        _sendPayout(batchId, recipients[len - 1], lastAmount);

        emit BatchPaid(batchId, platformId, msg.sender, recipients, total, fee, ref);
    }

    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingToClaim();

        owed[msg.sender] = 0;
        _totalReceivedBy[msg.sender] += amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function setFee(uint16 newFeeBps) external onlyProtocolOwner {
        if (newFeeBps > 100) revert InvalidFeeBps();

        uint16 oldFeeBps = feeBps;
        feeBps = newFeeBps;

        emit FeeUpdated(oldFeeBps, newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyProtocolOwner {
        if (newTreasury == address(0)) revert ZeroAddress();

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function transferProtocolOwner(address newOwner) external onlyProtocolOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        pendingProtocolOwner = newOwner;
        emit ProtocolOwnerTransferStarted(newOwner);
    }

    function acceptProtocolOwnership() external {
        if (msg.sender != pendingProtocolOwner) revert Unauthorized();

        protocolOwner = msg.sender;
        pendingProtocolOwner = address(0);

        emit ProtocolOwnershipTransferred(msg.sender);
    }

    function claimFees() external onlyProtocolOwner nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert NoFeesAccrued();

        feesAccrued = 0;

        (bool ok, ) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FeesClaimed(treasury, amount);
    }

    receive() external payable {
        revert();
    }

    function getPlatform(
        uint256 platformId
    )
        external
        view
        platformExists(platformId)
        returns (address owner, string memory name, uint256 pool, uint256 totalPaid, uint256 batchCount_)
    {
        Platform storage platform = _platforms[platformId];
        return (platform.owner, platform.name, platform.pool, platform.totalPaid, platform.batchCount);
    }

    function poolOf(uint256 platformId) external view platformExists(platformId) returns (uint256) {
        return _platforms[platformId].pool;
    }

    function quote(uint256 total) external view returns (uint256 fee, uint256 debit) {
        fee = (total * feeBps) / 10_000;
        debit = total + fee;
    }

    function previewSplit(uint256[] calldata shares, uint256 total) external view returns (uint256[] memory amounts) {
        if (total == 0) revert ZeroTotal();

        uint256 len = shares.length;
        amounts = new uint256[](len);
        if (len == 0) {
            return amounts;
        }

        uint256 totalShares;
        for (uint256 i = 0; i < len; ++i) {
            uint256 share = shares[i];
            if (share == 0) revert ZeroShare();
            totalShares += share;
        }

        uint256 distributed;
        for (uint256 i = 0; i + 1 < len; ++i) {
            uint256 amount = (total * shares[i]) / totalShares;
            amounts[i] = amount;
            distributed += amount;
        }

        amounts[len - 1] = total - distributed;
    }

    function totalReceivedBy(address recipient) external view returns (uint256) {
        return _totalReceivedBy[recipient];
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────

    function _requirePlatformExists(uint256 platformId) internal view {
        if (platformId >= platformCount) revert PlatformNotFound();
    }

    /// @dev Checks operator authorization and deducts `total` from their spending
    ///      allowance. Reverts with OverOperatorAllowance when the allowance would
    ///      go negative. Platform owner bypasses the check entirely.
    function _deductOperatorAllowance(uint256 platformId, uint256 total, address platformOwner) internal {
        if (msg.sender == platformOwner) return; // owner has no cap

        uint256 remaining = operators[msg.sender][platformId];
        if (remaining == 0) revert Unauthorized();
        if (total > remaining) revert OverOperatorAllowance();

        operators[msg.sender][platformId] = remaining - total;
    }

    /// @dev Bounded native push with zero return-data buffer (assembly).
    ///      Caps gas at 50 000 to prevent a GasBomb recipient from consuming
    ///      the entire batch gas budget via return-data copy.  On failure the
    ///      amount is credited to owed[recipient] for pull withdrawal.
    function _sendPayout(uint256 batchId, address recipient, uint256 amount) internal {
        bool ok;
        assembly ("memory-safe") {
            // call(gas, to, value, argsOffset, argsSize, retOffset, retSize)
            // retSize = 0  →  EVM never copies return data into memory,
            //                 so a recipient that returns megabytes costs no
            //                 extra memory-expansion gas on the caller side.
            ok := call(50000, recipient, amount, 0, 0, 0, 0)
        }
        if (ok) {
            _totalReceivedBy[recipient] += amount;
            emit PayoutSent(batchId, recipient, amount);
        } else {
            owed[recipient] += amount;
            emit PayoutCredited(batchId, recipient, amount);
        }
    }
}
