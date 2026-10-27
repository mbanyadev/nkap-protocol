// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts}     from "../NkapPayouts.sol";

/// Tests: 1-8, 14-19 (batch payout / payoutSplit / validations)
contract NkapPayoutsBatchTest is NkapPayoutsBase {

    // ── Distinct refs ─────────────────────────────────────────────────────────
    bytes32 internal constant REF1  = bytes32("ref1");
    bytes32 internal constant REF2  = bytes32("ref2");
    bytes32 internal constant REF3  = bytes32("ref3");
    bytes32 internal constant REF4  = bytes32("ref4");
    bytes32 internal constant REF5  = bytes32("ref5");
    bytes32 internal constant REF6  = bytes32("ref6");
    bytes32 internal constant REF7  = bytes32("ref7");
    bytes32 internal constant REF8  = bytes32("ref8");

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1 — 3-recipient exact batch from funded pool
    // ─────────────────────────────────────────────────────────────────────────
    function test_ThreeRecipientBatchFromPool() public {
        _fund(10 ether);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 3 ether;
        amounts[1] = 2 ether;
        amounts[2] = 1 ether;

        uint256 total = 6 ether;
        (uint256 fee, uint256 debit) = _feeDebit(total);
        assertEq(fee,   24e15,  "fee should be 0.024 ether");
        assertEq(debit, 6.024 ether, "debit should be 6.024 ether");

        uint256 poolBefore   = nkap.poolOf(PLATFORM);
        uint256 aliceBefore  = alice.balance;
        uint256 bobBefore    = bob.balance;
        uint256 carolBefore  = carol.balance;

        vm.prank(alice);
        uint256 batchId = nkap.payout(PLATFORM, recipients, amounts, REF1);

        assertEq(batchId, 1, "first batchId should be 1");
        assertEq(nkap.poolOf(PLATFORM), poolBefore - debit, "pool decremented by debit");
        assertEq(nkap.feesAccrued(), fee, "feesAccrued == fee");
        assertEq(alice.balance,  aliceBefore  + 3 ether, "alice received 3 ether");
        assertEq(bob.balance,    bobBefore    + 2 ether, "bob received 2 ether");
        assertEq(carol.balance,  carolBefore  + 1 ether, "carol received 1 ether");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2 — Fund-and-pay in one call
    // ─────────────────────────────────────────────────────────────────────────
    function test_FundAndPayInOneCall() public {
        // Pool starts at 0
        assertEq(nkap.poolOf(PLATFORM), 0);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 3 ether;
        amounts[1] = 2 ether;
        amounts[2] = 1 ether;

        uint256 total = 6 ether;
        (, uint256 debit) = _feeDebit(total);

        uint256 msgVal = 10 ether;
        uint256 expectedPool = msgVal - debit; // 3.976 ether

        vm.deal(alice, 20 ether);
        vm.prank(alice);
        nkap.payout{value: msgVal}(PLATFORM, recipients, amounts, REF2);

        assertEq(nkap.poolOf(PLATFORM), expectedPool, "pool remainder == 3.976 ether");

        (uint256 fee,) = _feeDebit(total);
        assertEq(nkap.feesAccrued(), fee, "feesAccrued == fee");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3 — 0.03 USDC batch
    // ─────────────────────────────────────────────────────────────────────────
    function test_SmallBatch_003() public {
        _fund(1 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;

        uint256[] memory amounts = new uint256[](1);
        uint256 amount = 3e16; // 0.03 ether
        amounts[0] = amount;

        (uint256 fee, uint256 debit) = _feeDebit(amount);
        assertEq(fee, 12e13, "fee == 12e13");

        uint256 poolBefore = nkap.poolOf(PLATFORM);
        uint256 bobBefore  = bob.balance;

        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, REF3);

        assertEq(bob.balance,             bobBefore + amount,    "bob received 0.03 ether");
        assertEq(nkap.poolOf(PLATFORM),   poolBefore - debit,    "pool decreased by debit");
        assertEq(nkap.feesAccrued(),       fee,                   "feesAccrued == 12e13");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4 — 50/30/20 pro-rata split
    // ─────────────────────────────────────────────────────────────────────────
    function test_ProRataSplit_503020() public {
        _fund(10 ether);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 50;
        shares[1] = 30;
        shares[2] = 20;

        uint256 total = 5 ether;
        (uint256 fee, uint256 debit) = _feeDebit(total);
        assertEq(fee,   2e16,   "fee == 0.02 ether");
        assertEq(debit, 5.02 ether, "debit == 5.02 ether");

        // Expected amounts (totalShares = 100)
        uint256 a0 = (total * 50) / 100; // 2.5 ether
        uint256 a1 = (total * 30) / 100; // 1.5 ether
        uint256 a2 = total - a0 - a1;    // 1.0 ether

        uint256 poolBefore  = nkap.poolOf(PLATFORM);
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;
        uint256 carolBefore = carol.balance;

        vm.prank(alice);
        nkap.payoutSplit(PLATFORM, recipients, shares, total, REF4);

        assertEq(alice.balance,         aliceBefore  + a0, "alice 2.5 ether");
        assertEq(bob.balance,           bobBefore    + a1, "bob 1.5 ether");
        assertEq(carol.balance,         carolBefore  + a2, "carol 1.0 ether");
        assertEq(nkap.poolOf(PLATFORM), poolBefore   - debit, "pool decreased by debit");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5 — Rounding dust to last recipient
    // ─────────────────────────────────────────────────────────────────────────
    function test_RoundingDustToLast() public {
        _fund(10 ether);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = 1;
        shares[1] = 1;
        shares[2] = 1;

        uint256 total = 1 ether; // 1e18 / 3 doesn't divide evenly
        // totalShares = 3
        // a0 = 1e18*1/3 = 333333333333333333
        // a1 = 1e18*1/3 = 333333333333333333
        // last = 1e18 - 333333333333333333 - 333333333333333333 = 333333333333333334
        uint256 a0   = total / 3;
        uint256 a1   = total / 3;
        uint256 last = total - a0 - a1;

        assertEq(last, 333333333333333334, "last gets one extra wei");

        uint256 carolBefore = carol.balance;

        vm.prank(alice);
        nkap.payoutSplit(PLATFORM, recipients, shares, total, REF5);

        assertEq(carol.balance - carolBefore, last, "carol got the dust wei");
        // No value lost: sum of received == total
        assertEq(a0 + a1 + last, total, "sum equals total");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7 — 200-recipient batch
    // ─────────────────────────────────────────────────────────────────────────
    function test_TwoHundredRecipientBatch() public {
        _fund(200 ether);

        address[] memory recipients = new address[](200);
        uint256[] memory amounts    = new uint256[](200);

        for (uint256 i = 0; i < 200; i++) {
            // derive unique addresses deterministically
            recipients[i] = address(uint160(uint256(keccak256(abi.encodePacked("r200", i)))));
            amounts[i]     = 0.5 ether;
        }

        uint256 total = 100 ether; // 200 * 0.5
        (uint256 fee, uint256 debit) = _feeDebit(total);
        assertEq(fee,   4e17,      "fee == 0.4 ether");
        assertEq(debit, 100.4 ether, "debit == 100.4 ether");

        uint256 poolBefore   = nkap.poolOf(PLATFORM);
        uint256 batchsBefore = nkap.batchCount();
        uint256 paidBefore   = nkap.totalPaidOut();

        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, REF7);

        assertEq(nkap.poolOf(PLATFORM), poolBefore   - debit,         "pool decreased by debit");
        assertEq(nkap.batchCount(),      batchsBefore + 1,              "batchCount incremented");
        assertEq(nkap.totalPaidOut(),    paidBefore   + total,          "totalPaidOut increased");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8 — Insufficient pool revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_InsufficientPool() public {
        _fund(1 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2 ether; // more than pool

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.InsufficientPool.selector);
        nkap.payout(PLATFORM, recipients, amounts, REF8);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 14 — address(0) recipient revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_ZeroAddressRecipient() public {
        _fund(1 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = address(0);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0.1 ether;

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.ZeroAddress.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("zeroaddr"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 15 — Empty batch revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_EmptyBatch() public {
        _fund(1 ether);

        address[] memory recipients = new address[](0);
        uint256[] memory amounts    = new uint256[](0);

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.EmptyBatch.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("empty"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 16 — Length mismatch revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_LengthMismatch() public {
        _fund(1 ether);

        address[] memory recipients = new address[](2);
        recipients[0] = bob;
        recipients[1] = carol;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0.1 ether;

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.LengthMismatch.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("mismatch"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 17 — Zero amount revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_ZeroAmount() public {
        _fund(1 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.ZeroAmount.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("zeroamt"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 18 — Too many recipients revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_TooManyRecipients() public {
        _fund(1000 ether);

        address[] memory recipients = new address[](201);
        uint256[] memory amounts    = new uint256[](201);
        for (uint256 i = 0; i < 201; i++) {
            recipients[i] = address(uint160(uint256(keccak256(abi.encodePacked("tmr", i)))));
            amounts[i]     = 0.1 ether;
        }

        vm.prank(alice);
        vm.expectRevert(NkapPayouts.TooManyRecipients.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("toomany"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 19 — Direct ETH transfer revert
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_DirectEthTransfer() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(nkap).call{value: 0.1 ether}("");
        assertFalse(ok, "direct ETH transfer must revert");
    }
}
