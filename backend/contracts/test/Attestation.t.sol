// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AmberAttestation} from "../Attestation.sol";

contract AmberAttestationTest is Test {
    AmberAttestation internal registry;

    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);
    address internal identity = address(0xDEAD);

    // Mirror the contract's events for vm.expectEmit.
    event Attestation(bytes32 indexed merkleRoot, address indexed identity, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        registry = new AmberAttestation(owner);
    }

    // --- Constructor ---

    function test_Constructor_SetsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_Constructor_EmitsOwnershipTransferred() public {
        vm.expectEmit(true, true, false, true);
        emit OwnershipTransferred(address(0), owner);
        new AmberAttestation(owner);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(AmberAttestation.ZeroAddress.selector);
        new AmberAttestation(address(0));
    }

    // --- attest ---

    function test_Attest_EmitsEvent() public {
        bytes32 root = keccak256("merkle-root");
        uint256 ts = 1_700_000_000;

        vm.expectEmit(true, true, false, true, address(registry));
        emit Attestation(root, identity, ts);

        vm.prank(owner);
        registry.attest(root, identity, ts);
    }

    function test_Attest_RevertsForNonOwner() public {
        vm.expectRevert(AmberAttestation.NotOwner.selector);
        vm.prank(stranger);
        registry.attest(keccak256("x"), identity, 1);
    }

    function testFuzz_Attest_EmitsWithArbitraryArgs(bytes32 root, address id, uint256 ts) public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit Attestation(root, id, ts);

        vm.prank(owner);
        registry.attest(root, id, ts);
    }

    // --- transferOwnership ---

    function test_TransferOwnership_UpdatesOwnerAndEmits() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit OwnershipTransferred(owner, stranger);

        vm.prank(owner);
        registry.transferOwnership(stranger);

        assertEq(registry.owner(), stranger);
    }

    function test_TransferOwnership_NewOwnerCanAttest() public {
        vm.prank(owner);
        registry.transferOwnership(stranger);

        // Old owner can no longer attest.
        vm.expectRevert(AmberAttestation.NotOwner.selector);
        vm.prank(owner);
        registry.attest(keccak256("x"), identity, 1);

        // New owner can.
        vm.prank(stranger);
        registry.attest(keccak256("y"), identity, 2);
    }

    function test_TransferOwnership_RevertsForNonOwner() public {
        vm.expectRevert(AmberAttestation.NotOwner.selector);
        vm.prank(stranger);
        registry.transferOwnership(stranger);
    }

    function test_TransferOwnership_RevertsOnZeroAddress() public {
        vm.expectRevert(AmberAttestation.ZeroAddress.selector);
        vm.prank(owner);
        registry.transferOwnership(address(0));
    }
}
