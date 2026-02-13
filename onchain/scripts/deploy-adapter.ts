import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

async function main(): Promise<void> {
  const contractName =
    process.env.TARGET_ADAPTER_CONTRACT?.trim() || "CurvanceTargetAdapter";
  const factory = await ethers.getContractFactory(contractName);
  const adapter = await factory.deploy();
  await adapter.waitForDeployment();

  console.log(`${contractName} deployed at: ${await adapter.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
