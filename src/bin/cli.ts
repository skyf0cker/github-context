#!/usr/bin/env bun
import { initializeCLI } from "../cli/commands";

const program = initializeCLI();
program.parse();
