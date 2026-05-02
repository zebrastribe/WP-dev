import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirmProduction(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} Type "yes" to continue: `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
