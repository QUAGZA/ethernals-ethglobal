require("@nomicfoundation/hardhat-ethers");

/** Hardhat is used only to compile and test. Deployment to Hedera happens in apps/server/scripts/deploy-ledger.ts. */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      // Hedera's EVM is Cancun-compatible, but "paris" is the safest target and costs nothing here.
      evmVersion: "paris",
    },
  },
};
