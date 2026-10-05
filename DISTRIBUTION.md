# Platform distribution

Users connect to the hosted `/mcp` endpoint. A plugin package installs that connection definition; it does not install or start the Africa’s Talking server on their computer. Provider credentials are entered only during browser OAuth consent.

## Package in this repository

`plugins/africastalking/` contains a portable Agent Plugins manifest and remote `mcp.json`, plus the supported Codex compatibility manifest and `.mcp.json`. `.agents/plugins/marketplace.json` makes the package available through a repository marketplace in supported desktop clients. These are distribution files, not evidence of approval or real-client verification. The reference origin is `https://at.blackielabs.com`; self-hosting publishers must change both remote definitions to their deployment URL.

For repository distribution, a publisher or user can add `Blackie360/africastalking-mcp` as a marketplace source, then choose Africa’s Talking and Install in the desktop plugin directory. Repository marketplace distribution is separate from public directory publication. It still requires adding the marketplace source once. Do not describe it as a public listing.

The website's Claude and ChatGPT buttons copy the URL and open their connection settings. Codex shows the desktop MCP settings and copies the URL. Until published listings provide install URLs, these clients still require pasting the URL and confirming the connection. No undocumented auto-install links or API keys in URLs are used.

## Cursor public marketplace

Submit the public repository/plugin package at [Cursor Marketplace Publish](https://cursor.com/marketplace/publish). Cursor accepts a portable root `plugin.json` or its own `.cursor-plugin/plugin.json`. This repository keeps the portable plugin root under `plugins/africastalking`; identify that subdirectory in submission where supported, or distribute its contents as a dedicated plugin repository if the portal requires a root manifest. Include publisher information, a logo and an accurate description that says this integration is unofficial. Cursor reviews plugins before listing them. After approval, link the actual marketplace listing from the connection page. The existing native MCP install button works independently of marketplace approval.

Source: [Cursor plugin submission reference](https://cursor.com/docs/reference/plugins).

## Claude directory

Use the [Claude directory submission portal linked from Anthropic's announcement](https://claude.com/blog/build-plugins-for-claude). The portal is available to developers on paid Claude plans. Submit the hosted service as a single remote MCP connector, or submit a GitHub plugin bundle. For this service, a single remote connector is the simplest path. Supply the HTTPS MCP endpoint and OAuth details, branding and the information requested by the portal. Review automated validation/security findings, resolve issues, wait for approval, then publish. Use the actual approved listing URL on the website.

## ChatGPT and Codex shared public directory

Follow [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission). Upload a ZIP with the contents of `plugins/africastalking/` at the ZIP root to the Plugins section of the OpenAI platform. Select the owning organization/project and verified publishing identity. Organization owners can submit; other members need Apps Management Write.

Connect the declared MCP server in the portal, complete the domain-verification challenge at the exact HTTPS path/token it supplies, and complete OAuth using a dedicated sandbox test account. The challenge token is not known in advance; do not add an invented token or replace another app's challenge.

Prepare five positive and three negative test cases, a walkthrough video, release notes, accurate publisher/contact details and the requested privacy/data-handling information. Put reviewer credentials only in the portal's designated private fields. Resolve package and tool-scan findings, submit for review, and publish after approval. The published plugin is listed in the universal directory shared by ChatGPT and Codex; repository marketplace installation is a separate route.

## Readiness before submission

The service must be publicly reachable and OAuth must complete in the target clients. Verify sandbox balance and previews, per-user isolation, refresh/revocation and disconnect. Explain encrypted credential storage, operator access, retention/deletion, optional sending and live-account charges accurately. Automated Node tests and package files alone do not establish service readiness or guarantee approval. Do not label this as an official Africa’s Talking product.
