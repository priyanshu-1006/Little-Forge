# Publish Little Forge CLI

The public npm package is `little-forge-cli`. Its executable is `little-forge`. The commands below use release `0.2.1`.

## Build the release

From the repository root, run the following commands if you need to rebuild the archive.

```powershell
npm.cmd ci
npm.cmd --prefix .\packages\cli run release:prepare
```

The command builds the CLI, checks the npm file list, and writes `output/npm-release/0.2.1/little-forge-cli-0.2.1.tgz` and `SHA256SUMS.txt`. It also copies the same tarball to the website download directory and updates the website's package metadata.

## Sign in and check the archive

Use the npm account that should own the package. Enable two-factor authentication on that account and complete the browser prompts opened by npm. Run the commands below from the repository root. [npm publishing and 2FA](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/#direct-publishing)

```powershell
npm.cmd login --registry=https://registry.npmjs.org/
npm.cmd whoami --registry=https://registry.npmjs.org/
npm.cmd publish '.\output\npm-release\0.2.1\little-forge-cli-0.2.1.tgz' --access public --dry-run --registry=https://registry.npmjs.org/
```

Check that the dry run reports `little-forge-cli@0.2.1` and the expected five files. The archive contains the executable bundle, package metadata, README, MIT license, and third-party notices.

## Publish and verify

Run this after reviewing the dry run. Complete npm's two-factor challenge if prompted.

```powershell
npm.cmd publish '.\output\npm-release\0.2.1\little-forge-cli-0.2.1.tgz' --access public --registry=https://registry.npmjs.org/
npm.cmd view little-forge-cli@0.2.1 version --registry=https://registry.npmjs.org/
```

To test the public release, install it from the registry and check that the executable opens.

```powershell
npm.cmd install -g little-forge-cli@0.2.1 --registry=https://registry.npmjs.org/
little-forge.cmd --version
little-forge.cmd
```

For a later release, increment `version` in `packages/cli/package.json`, rebuild, and use the new archive path. npm does not let you reuse a published name-and-version pair. [npm publish reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
