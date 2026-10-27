// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NkapPayouts} from "../NkapPayouts.sol";

// ── Helper contracts ──────────────────────────────────────────────────────────

/// @dev Rejects all ETH pushes; used to test credit-on-fail path.
contract RejectingRecipient {
    receive() external payable {
        revert("reject");
    }
}

/// @dev Toggleable receiver; used to test the full credit→withdraw flow.
contract ToggleRecipient {
    bool public accept;

    receive() external payable {
        require(accept, "not accepting");
    }

    function enable() external {
        accept = true;
    }

    function claim(NkapPayouts nkap) external {
        nkap.withdraw();
    }
}

/// @dev Returns a large blob of return data on every ETH receive to try to
///      inflate the caller's memory-expansion gas cost (GasBomb attack).
contract GasBombRecipient {
    receive() external payable {
        // Return 100 kB of data.  With a zero-retSize call this must cost the
        // CALLER nothing extra; with a naive (bool ok, bytes memory ret) call
        // the caller would pay ~8 500 extra gas per recipient.
        assembly {
            return(0, 102400)
        }
    }
}

/// @dev On ETH receive, tries to re-enter NkapPayouts.payout().
contract ReentrantRecipient {
    NkapPayouts public nkap;
    uint256 public platformId;
    bool public attacked;

    constructor(address payable _nkap, uint256 _platformId) {
        nkap = NkapPayouts(_nkap);
        platformId = _platformId;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Attempt re-entry; should revert with ReentrancyGuard
            address[] memory r = new address[](1);
            r[0] = address(this);
            uint256[] memory a = new uint256[](1);
            a[0] = 1 ether;
            try nkap.payout(platformId, r, a, bytes32("reentrant")) {} catch {}
        }
    }
}

// ── Base test contract ────────────────────────────────────────────────────────

abstract contract NkapPayoutsBase is Test {
    NkapPayouts internal nkap;

    address internal protocolOwner = makeAddr("protocolOwner");
    address internal treasury      = makeAddr("treasury");
    address internal alice         = makeAddr("alice");   // platform owner
    address internal bob           = makeAddr("bob");
    address internal carol         = makeAddr("carol");
    address internal dave          = makeAddr("dave");
    address internal stranger      = makeAddr("stranger");

    uint16  internal constant FEE_BPS  = 40;   // 0.40 %
    uint256 internal constant PLATFORM = 0;

    function setUp() public virtual {
        vm.startPrank(protocolOwner);
        nkap = new NkapPayouts(treasury, FEE_BPS);
        vm.stopPrank();

        // alice creates platform 0
        vm.prank(alice);
        nkap.createPlatform("Test Platform");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Fund alice's platform pool.
    function _fund(uint256 amount) internal {
        vm.deal(alice, alice.balance + amount);
        vm.prank(alice);
        nkap.fund{value: amount}(PLATFORM);
    }

    /// Compute fee and debit for a given total.
    function _feeDebit(uint256 total) internal pure returns (uint256 fee, uint256 debit) {
        fee   = (total * FEE_BPS) / 10_000;
        debit = total + fee;
    }
}
