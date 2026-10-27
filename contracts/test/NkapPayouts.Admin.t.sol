// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts}     from "../NkapPayouts.sol";

/// Tests: 22-25 (withdrawPool, claimFees, protocol admin, platform isolation)
contract NkapPayoutsAdminTest is NkapPayoutsBase {

    // ─────────────────────────────────────────────────────────────────────────
    // Test 22 — withdrawPool
    // ─────────────────────────────────────────────────────────────────────────
    function test_WithdrawPool() public {
        _fund(5 ether);

        uint256 poolBefore = nkap.poolOf(PLATFORM);
        uint256 recvBefore = dave.balance;

        vm.prank(alice);
        nkap.withdrawPool(PLATFORM, 3 ether, dave);

        assertEq(nkap.poolOf(PLATFORM), poolBefore - 3 ether, "pool == 2 ether");
        assertEq(dave.balance,           recvBefore + 3 ether, "dave received 3 ether");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 23 — claimFees to treasury
    // ─────────────────────────────────────────────────────────────────────────
    function test_ClaimFees() public {
        // Accumulate fees via two payouts
        _fund(20 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;

        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("cf1"));

        amounts[0] = 3 ether;
        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("cf2"));

        uint256 accruedBefore = nkap.feesAccrued();
        assertGt(accruedBefore, 0, "fees have been accrued");

        uint256 treasuryBefore = treasury.balance;

        vm.prank(protocolOwner);
        nkap.claimFees();

        assertEq(nkap.feesAccrued(), 0, "feesAccrued cleared to 0");
        assertEq(treasury.balance, treasuryBefore + accruedBefore, "treasury received fees");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 24 — Protocol admin checks
    // ─────────────────────────────────────────────────────────────────────────

    // setFee: non-owner reverts
    function test_Revert_SetFee_NonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.setFee(50);
    }

    // setFee: feeBps > 100 reverts
    function test_Revert_SetFee_InvalidFeeBps() public {
        vm.prank(protocolOwner);
        vm.expectRevert(NkapPayouts.InvalidFeeBps.selector);
        nkap.setFee(101);
    }

    // setFee: owner can set to 0
    function test_SetFee_ToZero() public {
        vm.prank(protocolOwner);
        nkap.setFee(0);
        assertEq(nkap.feeBps(), 0, "feeBps == 0");
    }

    // setFee: owner can set to 100
    function test_SetFee_ToMax() public {
        vm.prank(protocolOwner);
        nkap.setFee(100);
        assertEq(nkap.feeBps(), 100, "feeBps == 100");
    }

    // setTreasury: non-owner reverts
    function test_Revert_SetTreasury_NonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.setTreasury(stranger);
    }

    // setTreasury: address(0) reverts
    function test_Revert_SetTreasury_ZeroAddress() public {
        vm.prank(protocolOwner);
        vm.expectRevert(NkapPayouts.ZeroAddress.selector);
        nkap.setTreasury(address(0));
    }

    // setTreasury: owner succeeds
    function test_SetTreasury_Success() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(protocolOwner);
        nkap.setTreasury(newTreasury);
        assertEq(nkap.treasury(), newTreasury, "treasury updated");
    }

    // transferProtocolOwner / acceptProtocolOwnership: two-step
    function test_TransferProtocolOwnership_TwoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(protocolOwner);
        nkap.transferProtocolOwner(newOwner);
        assertEq(nkap.pendingProtocolOwner(), newOwner, "pendingProtocolOwner set");

        // Wrong acceptor reverts
        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.acceptProtocolOwnership();

        // Correct acceptor succeeds
        vm.prank(newOwner);
        nkap.acceptProtocolOwnership();
        assertEq(nkap.protocolOwner(), newOwner, "ownership transferred");
        assertEq(nkap.pendingProtocolOwner(), address(0), "pending cleared");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 25 — Two platforms' pools stay isolated
    // ─────────────────────────────────────────────────────────────────────────
    function test_PlatformsAreIsolated() public {
        // alice already owns platform 0 (from setUp)
        // bob creates platform 1
        vm.prank(bob);
        nkap.createPlatform("Bob Platform");
        uint256 platBob = 1;

        // Fund both
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        nkap.fund{value: 5 ether}(PLATFORM);

        vm.deal(bob, 10 ether);
        vm.prank(bob);
        nkap.fund{value: 3 ether}(platBob);

        // Pools set up correctly
        assertEq(nkap.poolOf(PLATFORM), 5 ether, "alice pool == 5 ether");
        assertEq(nkap.poolOf(platBob),  3 ether, "bob pool == 3 ether");

        // Alice pays from platform 0
        uint256 amt0 = 1 ether;
        (, uint256 debit0) = _feeDebit(amt0);

        address[] memory r0 = new address[](1);
        r0[0] = carol;
        uint256[] memory a0 = new uint256[](1);
        a0[0] = amt0;

        vm.prank(alice);
        nkap.payout(PLATFORM, r0, a0, bytes32("iso1"));

        // Bob pays from platform 1
        uint256 amt1 = 0.5 ether;
        (, uint256 debit1) = _feeDebit(amt1);

        address[] memory r1 = new address[](1);
        r1[0] = dave;
        uint256[] memory a1 = new uint256[](1);
        a1[0] = amt1;

        vm.prank(bob);
        nkap.payout(platBob, r1, a1, bytes32("iso2"));

        // Verify isolation
        assertEq(nkap.poolOf(PLATFORM), 5 ether - debit0, "platform 0 pool reduced by its debit only");
        assertEq(nkap.poolOf(platBob),  3 ether - debit1, "platform 1 pool reduced by its debit only");

        // Bob cannot pay from alice's platform
        vm.prank(bob);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, r1, a1, bytes32("iso_cross"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Platform ownership two-step transfer
    // ─────────────────────────────────────────────────────────────────────────
    function test_TransferPlatformOwnership_TwoStep() public {
        address newOwner = makeAddr("newPlatformOwner");

        vm.prank(alice);
        nkap.transferPlatformOwner(PLATFORM, newOwner);

        // Wrong acceptor reverts
        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.acceptPlatformOwnership(PLATFORM);

        // Correct acceptor succeeds
        vm.prank(newOwner);
        nkap.acceptPlatformOwnership(PLATFORM);

        (address owner,,,,) = nkap.getPlatform(PLATFORM);
        assertEq(owner, newOwner, "platform owner transferred");
    }
}
