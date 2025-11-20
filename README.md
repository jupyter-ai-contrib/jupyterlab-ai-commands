# jupyterlab-ai-commands

[![Github Actions Status](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/workflows/Build/badge.svg)](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/actions/workflows/build.yml)

A set of commands for AI in JupyterLab

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab-ai-commands
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab-ai-commands
```

## Available Commands

This extension provides the following commands for AI-assisted interactions with JupyterLab:

### File Commands

- **`jupyterlab-ai-commands:create-file`** - Create a new file of specified type (text, python, markdown, json, etc.)
  - Arguments:
    - `fileName` (string): Name of the file to create
    - `fileType` (string): Type of file to create (e.g., text, python, markdown, json, javascript, typescript, yaml, julia, r, csv)
    - `content` (string, optional): Initial content for the file
    - `cwd` (string, optional): Directory where to create the file

- **`jupyterlab-ai-commands:open-file`** - Open a file in the editor
  - Arguments:
    - `filePath` (string): Path to the file to open

- **`jupyterlab-ai-commands:delete-file`** - Delete a file from the file system
  - Arguments:
    - `filePath` (string): Path to the file to delete

- **`jupyterlab-ai-commands:rename-file`** - Rename a file or move it to a different location
  - Arguments:
    - `oldPath` (string): Current path of the file
    - `newPath` (string): New path/name for the file

- **`jupyterlab-ai-commands:copy-file`** - Copy a file to a new location
  - Arguments:
    - `sourcePath` (string): Path of the file to copy
    - `destinationPath` (string): Destination path for the copied file

- **`jupyterlab-ai-commands:navigate-to-directory`** - Navigate to a specific directory in the file browser
  - Arguments:
    - `directoryPath` (string): Path to the directory to navigate to

- **`jupyterlab-ai-commands:list-directory`** - List files and directories in a specific directory
  - Arguments:
    - `directoryPath` (string, optional): Path to the directory to list. If not provided, lists the root directory
    - `includeHidden` (boolean, optional): Whether to include hidden files (default: false)

- **`jupyterlab-ai-commands:get-file-info`** - Get information about a file including its path, name, extension, and content
  - Arguments:
    - `filePath` (string, optional): Path to the file to read. If not provided, uses the currently active file in the editor

- **`jupyterlab-ai-commands:set-file-content`** - Set or update the content of an existing file
  - Arguments:
    - `filePath` (string): Path to the file to update
    - `content` (string): The new content to set for the file
    - `save` (boolean, optional): Whether to save the file after updating (default: true)
    - `showDiff` (boolean, optional): Whether to show a diff view of the changes (default: true)

### Notebook Commands

- **`jupyterlab-ai-commands:create-notebook`** - Create a new Jupyter notebook with a kernel for the specified programming language
  - Arguments:
    - `language` (string, optional): The programming language for the notebook (e.g., python, r, julia, javascript, etc.). Will use system default if not specified
    - `name` (string): Name for the notebook file (without .ipynb extension)

- **`jupyterlab-ai-commands:add-cell`** - Add a cell to the current notebook with optional content
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook
    - `content` (string, optional): Content to add to the cell
    - `cellType` (string, optional): Type of cell to add - "code", "markdown", or "raw" (default: "code")
    - `position` (string, optional): Position relative to current cell - "above" or "below" (default: "below")

- **`jupyterlab-ai-commands:get-notebook-info`** - Get information about a notebook including number of cells and active cell index
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook

- **`jupyterlab-ai-commands:get-cell-info`** - Get information about a specific cell including its type, source content, and outputs
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook
    - `cellIndex` (number, optional): Index of the cell to get information for (0-based). If not provided, uses the currently active cell

- **`jupyterlab-ai-commands:set-cell-content`** - Set the content of a specific cell
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook
    - `cellId` (string, optional): ID of the cell to modify. If provided, takes precedence over cellIndex
    - `cellIndex` (number, optional): Index of the cell to modify (0-based). Used if cellId is not provided. If neither is provided, targets the active cell
    - `content` (string): New content for the cell
    - `showDiff` (boolean, optional): Whether to show a diff view of the changes (default: true)

- **`jupyterlab-ai-commands:run-cell`** - Run a specific cell in the notebook by index
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook
    - `cellIndex` (number): Index of the cell to run (0-based)
    - `recordTiming` (boolean, optional): Whether to record execution timing (default: true)

- **`jupyterlab-ai-commands:delete-cell`** - Delete a specific cell from the notebook by index
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook
    - `cellIndex` (number): Index of the cell to delete (0-based)

- **`jupyterlab-ai-commands:save-notebook`** - Save a specific notebook to disk
  - Arguments:
    - `notebookPath` (string, optional): Path to the notebook file. If not provided, uses the currently active notebook

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab_ai_commands directory
# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
pip uninstall jupyterlab_ai_commands
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `jupyterlab-ai-commands` within that folder.

### Testing the extension

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)
