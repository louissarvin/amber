// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {AmberAttestation} from "../Attestation.sol";

/// @title DeployAttestation
/// @notice Foundry deploy script for the AmberAttestation event-only registry.
/// @dev Usage (X Layer mainnet, chainId 196):
///
///   ATTESTATION_OWNER=0x0fbfa76f1f7f26ff5ab05516128b51119d52f967 \
///   forge script script/DeployAttestation.s.sol \
///     --rpc-url xlayer \
///     --broadcast \
///     --private-key $DEPLOYER_PK
///
///   The broadcast (deployer) key is supplied ONLY at runtime via --private-key
///   or --account <keystore>. It is NEVER read from a committed file or env var
///   inside this script. vm.startBroadcast() with no argument pulls the signer
///   from the CLI, so the raw key never touches Solidity source or storage.
///
///   The constructor owner is read from ATTESTATION_OWNER. This MUST be the
///   OKX/ASP wallet (0x0fbfa76f1f7f26ff5ab05516128b51119d52f967) because the
///   backend calls attest() from that wallet under SIGNER_MODE=tee, and attest()
///   is onlyOwner.
contract DeployAttestation is Script {
    /// @notice The required attestation owner: the OKX/ASP wallet.
    /// @dev attest() is onlyOwner and is invoked by this wallet via SIGNER_MODE=tee.
    address internal constant EXPECTED_OWNER = 0x0FBfa76F1F7f26fF5Ab05516128b51119d52F967;

    /// @notice Deploys AmberAttestation with the owner from ATTESTATION_OWNER.
    /// @return attestation The deployed AmberAttestation instance.
    function run() external returns (AmberAttestation attestation) {
        // Read the constructor owner from env. Defaults to the OKX/ASP wallet if unset.
        address owner = vm.envOr("ATTESTATION_OWNER", EXPECTED_OWNER);
        require(owner != address(0), "ATTESTATION_OWNER is the zero address");

        // Warn loudly if the owner is not the expected OKX/ASP wallet. attest() is
        // onlyOwner, so a wrong owner makes the deployment unusable by the backend.
        if (owner != EXPECTED_OWNER) {
            console2.log("WARNING: ATTESTATION_OWNER is not the expected OKX/ASP wallet.");
            console2.log("  provided owner:", owner);
            console2.log("  expected owner:", EXPECTED_OWNER);
        }

        // Broadcast: the signer comes from --private-key / --account at the CLI.
        vm.startBroadcast();
        attestation = new AmberAttestation(owner);
        vm.stopBroadcast();

        console2.log("AmberAttestation deployed at:", address(attestation));
        console2.log("Owner set to:", attestation.owner());
        console2.log("Chain id:", block.chainid);
    }
}
