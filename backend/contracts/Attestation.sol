// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract AmberAttestation {
    error NotOwner();
    error ZeroAddress();

    address public owner;

    event Attestation(
        bytes32 indexed merkleRoot,
        address indexed identity,
        uint256 timestamp
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function attest(
        bytes32 merkleRoot,
        address identity,
        uint256 timestamp
    ) external onlyOwner {
        emit Attestation(merkleRoot, identity, timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
