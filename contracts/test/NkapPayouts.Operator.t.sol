// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts}     from "../NkapPayouts.sol";

/// Tests: 9-13 (operator / stranger auth) — updated for spending-allowance model
contract NkapPayoutsOperatorTest is NkapPayoutsBase {

    address internal operator = makeAddr("operator");

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9 — Stranger cannot pay
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_StrangerCannotPay() public {
        _fund(5 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(stranger);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("stranger"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: single-recipient 0.1-ether payout for `caller`
    // ─────────────────────────────────────────────────────────────────────────
    function _operatorPayout(address caller, bytes32 ref) internal {
        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0.1 ether;

        vm.prank(caller);
        nkap.payout(PLATFORM, recipients, amounts, ref);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests 10-11 — Operator within allowance / over allowance
    // The allowance is now a total USDC budget, decremented by batch total.
    // Three batches of 0.1 ether each against a 0.35-ether allowance leaves
    // 0.05 ether; a 4th batch of 0.1 ether must revert OverOperatorAllowance.
    // ─────────────────────────────────────────────────────────────────────────
    function test_OperatorWithinAllowance() public {
        // 0.35 ether allows three 0.1-ether batches (leaves 0.05 ether)
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 0.35 ether);

        _fund(10 ether);

        _operatorPayout(operator, bytes32("op1"));
        assertEq(nkap.operators(operator, PLATFORM), 0.25 ether, "after 1st batch");

        _operatorPayout(operator, bytes32("op2"));
        assertEq(nkap.operators(operator, PLATFORM), 0.15 ether, "after 2nd batch");

        _operatorPayout(operator, bytes32("op3"));
        assertEq(nkap.operators(operator, PLATFORM), 0.05 ether, "after 3rd batch");
    }

    function test_Revert_OperatorOverAllowance() public {
        // 0.25 ether allows exactly two 0.1-ether batches; 3rd exceeds allowance
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 0.25 ether);

        _fund(10 ether);

        _operatorPayout(operator, bytes32("op1"));
        _operatorPayout(operator, bytes32("op2"));

        // Allowance is now 0.05 ether; a 0.1-ether batch exceeds it
        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0.1 ether;

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.OverOperatorAllowance.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("op3"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 12 — Operator cannot withdrawPool
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_OperatorCannotWithdrawPool() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 10 ether);

        _fund(5 ether);

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.withdrawPool(PLATFORM, 1 ether, operator);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 13 — Revoke operator (set allowance to 0)
    // ─────────────────────────────────────────────────────────────────────────
    function test_Revert_RevokeOperator() public {
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 5 ether);

        // Revoke by setting allowance to 0
        vm.prank(alice);
        nkap.setOperator(PLATFORM, operator, 0);

        _fund(5 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0.1 ether;

        vm.prank(operator);
        vm.expectRevert(NkapPayouts.Unauthorized.selector);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("revoked"));
    }
}
