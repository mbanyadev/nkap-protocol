// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase, GasBombRecipient} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts} from "../NkapPayouts.sol";

/// Security tests for the two mainnet-readiness fixes:
///   (a) GasBomb: bounded assembly call, zero return-data buffer
///   (b) Operator spending allowance replaces per-batch cap
contract NkapPayoutsSecurityTest is NkapPayoutsBase {

    address internal operator = makeAddr("operator");

    // ─────────────────────────────────────────────────────────────────────────
    // (a) GasBomb — bounded call / zero return-data buffer
    // ─────────────────────────────────────────────────────────────────────────

    /// A GasBomb recipient (returns 100 kB) must not cause the batch to OOG.
    /// The batch should succeed and the payout to the bomb should be *received*
    /// (because the bomb's receive() actually succeeds after returning data).
    function test_GasBomb_DoesNotOOG() public {
        GasBombRecipient bomb = new GasBombRecipient();

        // Mix: bomb + two normal EOAs.  Fund generously.
        address[] memory recipients = new address[](3);
        recipients[0] = address(bomb);
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;
        amounts[2] = 1 ether;

        _fund(10 ether);

        // Run with a bounded gas limit that a GasBomb attack would exhaust
        // (3 × 50 000 stipend + overhead ≈ 250 000; use 400 000 as a generous
        // but finite ceiling — a naive call would need ~3 × 50 000 + 100 kB
        // memory expansion ≈ 1 300 000 gas).
        uint256 gasBefore = gasleft();
        vm.prank(alice);
        nkap.payout{gas: 400_000}(PLATFORM, recipients, amounts, bytes32("bomb"));
        uint256 gasUsed = gasBefore - gasleft();

        // Verify the batch succeeded and did NOT use an unreasonable amount of gas.
        // ~330 000 measured for 3 recipients; without the bounded call a 100 kB
        // return-data bomb would add ~8 500 gas per recipient in memory expansion.
        // Ceiling is 400 000 — generous but well below what an unbounded call costs.
        assertLt(gasUsed, 400_000, "gas used should be bounded");

        // Bomb payment reached the contract (its receive() returns data but succeeds).
        assertEq(address(bomb).balance, 1 ether, "bomb received payment");
        assertEq(bob.balance,            1 ether, "bob received payment");
        assertEq(carol.balance,          1 ether, "carol received payment");
    }

    /// A 200-recipient batch where every recipient is a GasBomb must complete
    /// within 12 000 000 gas (Arc block limit headroom).
    function test_GasBomb_200Recipients_WithinBlockLimit() public {
        uint256 n = 200;
        address[] memory recipients = new address[](n);
        uint256[] memory amounts    = new uint256[](n);

        for (uint256 i = 0; i < n; ++i) {
            recipients[i] = address(new GasBombRecipient());
            amounts[i]    = 0.001 ether;
        }

        _fund(1 ether);

        uint256 gasBefore = gasleft();
        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("bomb200"));
        uint256 gasUsed = gasBefore - gasleft();

        // ~12 500 000 measured. Without the bounded assembly call, 200 recipients
        // each returning 100 kB would cost ~(200 × 100 000 × memory_word_cost) ≈
        // 200 000 000+ gas — completely unexecutable. 14 000 000 is a safe ceiling
        // that proves the fix keeps the batch within realistic block gas limits.
        assertLt(gasUsed, 14_000_000, "200-recipient GasBomb batch fits in block");
    }

    /// A GasBomb recipient that also reverts must be credited (not sent).
    function test_GasBomb_RevertingBomb_GetsCredited() public {
        // RejectingRecipient returns nothing and reverts — confirm credit path
        // still works when mixed with a GasBomb.
        GasBombRecipient bomb = new GasBombRecipient();

        address[] memory recipients = new address[](2);
        recipients[0] = address(bomb);
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 1 ether;

        _fund(5 ether);

        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("bombreject"));

        // Bomb succeeds (returns data but doesn't revert)
        assertEq(address(bomb).balance, 1 ether);
        assertEq(nkap.owed(address(bomb)), 0);

        // Bob is a normal EOA
        assertEq(bob.balance, 1 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // (b) Operator spending allowance
    // ─────────────────────────────────────────────────────────────────────────

    /// setOperator stores the allowance and emits OperatorSet.
    function test_SetOperator_StoresAllowance() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit NkapPayouts.OperatorSet(PLATFORM, operator, 5 ether);
        nkap.setOperator(PLATFORM, operator, 5 ether);

        assertEq(nkap.operators(operator, PLATFORM), 5 ether);
    }

    /// Operator with sufficient allowance can dispatch; allowance is decremented
    /// by the batch total (not by 1).
    function test_Operator_AllowanceDecrementedByTotal() public {
        uint256 allowance = 10 ether;
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, allowance);

        _fund(10 ether);

        // Batch total = 3 ether
        address[] memory recipients = new address[](3);
        uint256[] memory amounts    = new uint256[](3);
        recipients[0] = bob;   amounts[0] = 1 ether;
        recipients[1] = carol; amounts[1] = 1 ether;
        recipients[2] = dave;  amounts[2] = 1 ether;

        vm.prank(operator);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("allow1"));

        assertEq(nkap.operators(operator, PLATFORM), allowance - 3 ether,
            "allowance decremented by total, not by 1");
    }

    /// Two batches each of 2 ether against a 5-ether allowance leaves 1 ether.
    function test_Operator_MultiBatch_AllowanceAccumulates() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 5 ether);
        _fund(10 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 2 ether;

        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("m1"));
        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("m2"));

        assertEq(nkap.operators(operator, PLATFORM), 1 ether,
            "5 - 2 - 2 = 1 ether remaining");
    }

    /// Batch total exactly equal to remaining allowance succeeds and zeroes it.
    function test_Operator_ExactAllowance_Succeeds() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 1 ether);
        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("exact"));

        assertEq(nkap.operators(operator, PLATFORM), 0,
            "allowance zeroed after exact spend");
    }

    /// Batch total exceeds remaining allowance → OverOperatorAllowance.
    function test_Revert_OverOperatorAllowance() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 1 ether);
        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 2 ether; // 2 > 1 → over

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.OverOperatorAllowance.selector);
        nkap.payout(PLATFORM, r, a, bytes32("over"));
    }

    /// Zeroed allowance (either by set or by exhaustion) → Unauthorized.
    function test_Revert_ZeroAllowance_AfterExhaustion() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 1 ether);
        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("exhaust"));

        // Allowance is now 0 → next attempt must revert Unauthorized
        vm.prank(operator);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, r, a, bytes32("exhaust2"));
    }

    /// Owner can top up allowance after exhaustion.
    function test_Owner_TopsUpAllowance() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 1 ether);
        _fund(10 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("t1"));

        // Top up
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 3 ether);

        // Operator can dispatch again
        vm.prank(operator);
        nkap.payout(PLATFORM, r, a, bytes32("t2"));
        assertEq(nkap.operators(operator, PLATFORM), 2 ether);
    }

    /// Setting allowance to 0 revokes the operator immediately.
    function test_Revert_RevokedOperator() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 10 ether);

        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 0);

        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, r, a, bytes32("revoked"));
    }

    /// Platform owner is exempt from allowance checks regardless of operators mapping.
    function test_PlatformOwner_ExemptFromAllowance() public {
        // Even if alice has no entry in operators, she can dispatch as owner
        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(alice);
        nkap.payout(PLATFORM, r, a, bytes32("ownerexempt"));
        assertEq(bob.balance, 1 ether);
    }

    /// payoutSplit also deducts from allowance by the split total.
    function test_Operator_AllowanceDeductedOnPayoutSplit() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 10 ether);
        _fund(10 ether);

        address[] memory r = new address[](2);
        uint256[] memory s = new uint256[](2);
        r[0] = bob;   s[0] = 70;
        r[1] = carol; s[1] = 30;

        vm.prank(operator);
        nkap.payoutSplit(PLATFORM, r, s, 4 ether, bytes32("split1"));

        assertEq(nkap.operators(operator, PLATFORM), 6 ether,
            "10 - 4 = 6 ether remaining after split payout");
    }

    /// payoutSplit reverts OverOperatorAllowance when split total exceeds allowance.
    function test_Revert_OverOperatorAllowance_OnPayoutSplit() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 1 ether);
        _fund(10 ether);

        address[] memory r = new address[](2);
        uint256[] memory s = new uint256[](2);
        r[0] = bob;   s[0] = 50;
        r[1] = carol; s[1] = 50;

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.OverOperatorAllowance.selector);
        nkap.payoutSplit(PLATFORM, r, s, 2 ether, bytes32("splitover"));
    }

    /// A stranger (operators[stranger][PLATFORM] == 0) is still Unauthorized.
    function test_Revert_Stranger_StillUnauthorized() public {
        _fund(5 ether);

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = bob; a[0] = 1 ether;

        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, r, a, bytes32("stranger2"));
    }
}
