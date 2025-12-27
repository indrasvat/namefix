.PHONY: help all build test lint fmt check ci clean dev dev-app run-app release stage-resources

.DEFAULT_GOAL := help
SHELL := /bin/bash
PNPM := pnpm
NODE := node

help: ## Show this help message
	@printf "\033[1;36mnamefix\033[0m \033[36m(macOS screenshot renamer)\033[0m\n"
	@printf "\n"
	@printf "\033[1mUsage:\033[0m make \033[33m[target]\033[0m\n"
	@printf "\n"
	@printf "\033[1mAvailable targets:\033[0m\n"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-20s\033[0m %s\n", $$1, $$2}'

all: ci ## Run full CI pipeline (check + build)

build: ## Build shared core and CLI
	@printf "\033[33mBuilding shared core...\033[0m\n"
	@$(PNPM) run build

stage-resources: build ## Stage resources for Tauri build (persist)
	@printf "\033[33mStaging resources...\033[0m\n"
	@$(NODE) scripts/stage-dist.mjs --persist echo "Resources staged"

build-app: stage-resources ## Build macOS menu bar app (Tauri)
	@printf "\033[33mBuilding menu bar app...\033[0m\n"
	@$(PNPM) --filter @namefix/menu-bar run tauri:build

dev: ## Run CLI/TUI in dev mode
	@printf "\033[33mStarting CLI/TUI...\033[0m\n"
	@$(PNPM) start

dev-app: ## Run menu bar app in dev mode
	@printf "\033[33mStarting menu bar app (dev)...\033[0m\n"
	@$(PNPM) run menubar

run-app: build-app ## Build and run menu bar app (release)
	@printf "\033[32mStarting menu bar app...\033[0m\n"
	@open "apps/menu-bar/src-tauri/target/release/bundle/macos/Namefix Menu Bar.app"

test: ## Run unit tests
	@printf "\033[33mRunning tests...\033[0m\n"
	@$(PNPM) test

typecheck: ## Run TypeScript type checking
	@printf "\033[33mRunning type check...\033[0m\n"
	@$(PNPM) run typecheck

lint: ## Lint code
	@printf "\033[33mLinting...\033[0m\n"
	@$(PNPM) run lint

fmt: ## Format code
	@printf "\033[33mFormatting...\033[0m\n"
	@$(PNPM) run format

check: fmt lint typecheck test ## Run fmt + lint + typecheck + test

ci: check build ## Run full CI pipeline
	@printf "\033[32mCI pipeline complete!\033[0m\n"

clean: ## Clean build artifacts
	@printf "\033[33mCleaning...\033[0m\n"
	@rm -rf dist
	@rm -rf apps/menu-bar/dist
	@rm -rf apps/menu-bar/src-tauri/target
	@rm -rf coverage
	@rm -rf apps/menu-bar/src-tauri/resources/dist
	@rm -rf apps/menu-bar/src-tauri/resources/node_modules

release: ## Run semantic-release dry-run
	@printf "\033[33mRunning semantic-release dry-run...\033[0m\n"
	@$(PNPM) run release --dry-run
