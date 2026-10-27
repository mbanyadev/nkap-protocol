// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NkapPayoutsBase} from "./NkapPayouts.Base.t.sol";
import {NkapPayouts}     from "../NkapPayouts.sol";

/// Test 6 — Fuzz: no value lost in splits
contract NkapPayoutsFuzzTest is NkapPayoutsBase {

    function testFuzz_NoValueLostInSplit(
        uint256 total,
        uint256 s0,
        uint256 s1,
        uint256 s2
    ) public {
        // Bound inputs to reasonable ranges
        total = bound(total, 1e12, 1000 ether);
        s0    = bound(s0, 1, 1000);
        s1    = bound(s1, 1, 1000);
        s2    = bound(s2, 1, 1000);

        // Fund pool generously (debit = total + fee)
        (, uint256 debit) = _feeDebit(total);
        uint256 poolNeeded = debit + 1; // small buffer
        _fund(poolNeeded);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint256[] memory shares = new uint256[](3);
        shares[0] = s0;
        shares[1] = s1;
        shares[2] = s2;

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;
        uint256 carolBefore = carol.balance;

        vm.prank(alice);
        nkap.payoutSplit(PLATFORM, recipients, shares, total, bytes32("fuzz1"));

        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 bobGot   = bob.balance   - bobBefore;
        uint256 carolGot = carol.balance - carolBefore;

        // owed amounts (in case a push somehow failed, unlikely for EOAs)
        uint256 aliceOwed = nkap.owed(alice);
        uint256 bobOwed   = nkap.owed(bob);
        uint256 carolOwed = nkap.owed(carol);

        uint256 totalReceived = aliceGot + bobGot + carolGot + aliceOwed + bobOwed + carolOwed;
        assertEq(totalReceived, total, "sum of all received == total (no value lost)");
    }
}
