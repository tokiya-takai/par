#!/usr/bin/env node
import { FakeAdapter } from "./index.js";

// Uses the offline stub adapter. The intended default — a local `claude` agent
// invoked per review target — is wired in a later change; the stub keeps early
// builds runnable with no external dependencies or credentials.
const adapter = new FakeAdapter();
console.log(`par — preview build. adapter: ${adapter.name} (offline stub).`);
console.log("The cockpit server is not implemented yet.");
