// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase, RejectingRecipient, ToggleRecipient, ReentrantRecipient} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts} from "../NkapPayouts.sol";

/// Tests: 20-21 (credit-on-fail / reentrancy)
contract NkapPayoutsCreditTest is NkapPayoutsBase {

    // ─────────────────────────────────────────────────────────────────────────
    // Test 20 — Rejecting recipient credited and later withdraws
    // ─────────────────────────────────────────────────────────────────────────
    function test_CreditOnReject_OwedAccumulates() public {
        RejectingRecipient rejecter = new RejectingRecipient();
        _fund(5 ether);

        address[] memory recipients = new address[](2);
        recipients[0] = address(rejecter);
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 0.5 ether;

        uint256 total = 1.5 ether;
        (, uint256 debit) = _feeDebit(total);

        uint256 poolBefore = nkap.poolOf(PLATFORM);

        vm.prank(alice);
        uint256 batchId = nkap.payout(PLATFORM, recipients, amounts, bytes32("creditreject"));

        // Push to rejecter failed → owed
        assertGt(batchId, 0, "batchId > 0 (batch didn't revert)");
        assertEq(nkap.owed(address(rejecter)), 1 ether, "owed[rejecter] == 1 ether");

        // Pool still decreased by full debit
        assertEq(nkap.poolOf(PLATFORM), poolBefore - debit, "pool decreased by full debit");

        // bob got paid normally
        assertEq(bob.balance, 0.5 ether, "bob received 0.5 ether");
    }

    function test_CreditOnReject_ToggleAndWithdraw() public {
        ToggleRecipient toggle = new ToggleRecipient();
        // accept == false initially → will be credited
        _fund(5 ether);

        address[] memory recipients = new address[](1);
        recipients[0] = address(toggle);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2 ether;

        vm.prank(alice);
        nkap.payout(PLATFORM, recipients, amounts, bytes32("toggle1"));

        // Credit recorded
        assertEq(nkap.owed(address(toggle)), 2 ether, "owed == 2 ether");

        // Now enable accepting and withdraw
        toggle.enable();
        toggle.claim(nkap);

        assertEq(nkap.owed(address(toggle)), 0, "owed cleared after withdraw");
        assertEq(address(toggle).balance, 2 ether, "toggle received 2 ether");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 21 — Reentrancy attempt blocked
    // ─────────────────────────────────────────────────────────────────────────
    function test_ReentrancyBlocked() public {
        ReentrantRecipient reentrant = new ReentrantRecipient(payable(address(nkap)), PLATFORM);
        _fund(10 ether);

        address[] memory recipients = new address[](2);
        recipients[0] = address(reentrant);
        recipients[1] = carol;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1 ether;
        amounts[1] = 0.5 ether;

        uint256 owedBefore = nkap.owed(address(reentrant));

        vm.prank(alice);
        // Outer call succeeds
        uint256 batchId = nkap.payout(PLATFORM, recipients, amounts, bytes32("reentrant1"));

        assertGt(batchId, 0, "outer call returned a batchId");

        // The reentrant call either failed (reentrancy guard) → owed credited
        // OR the 50k-gas stipend prevented re-entry (insufficient gas)
        // Either way: contract did not drain pool unexpectedly; reentrant's
        // balance either has 1 ether (if push succeeded despite try) or owed has it.
        uint256 owedAfter = nkap.owed(address(reentrant));
        uint256 ethAfter  = address(reentrant).balance;

        // The sum of credited + pushed must equal the payout amount
        assertEq(owedAfter - owedBefore + ethAfter, 1 ether, "reentrant total == 1 ether");

        // carol received her share (outer batch completed)
        assertEq(carol.balance, 0.5 ether, "carol received 0.5 ether");
    }
}
