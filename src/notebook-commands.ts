import { CodeCell, ICodeCellModel, MarkdownCell } from '@jupyterlab/cells';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { Context, DocumentWidget } from '@jupyterlab/docregistry';
import {
  INotebookModel,
  INotebookTracker,
  Notebook,
  NotebookModelFactory,
  NotebookPanel
} from '@jupyterlab/notebook';
import { KernelSpec, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';

/**
 * Command IDs for diff management (from jupyterlab-diff)
 */
const UNIFIED_DIFF_COMMAND_ID = 'jupyterlab-diff:unified-cell-diff';
const SPLIT_DIFF_COMMAND_ID = 'jupyterlab-diff:split-cell-diff';

async function findKernelByLanguage(
  kernelSpecManager: KernelSpec.IManager,
  language?: string | null
): Promise<string> {
  await kernelSpecManager.ready;
  const specs = kernelSpecManager.specs;

  if (!specs || !specs.kernelspecs) {
    return 'python3';
  }

  if (!language) {
    return specs.default || Object.keys(specs.kernelspecs)[0] || 'python3';
  }

  const normalizedLanguage = language.toLowerCase().trim();

  for (const [kernelName, kernelSpec] of Object.entries(specs.kernelspecs)) {
    if (!kernelSpec) {
      continue;
    }

    const kernelLanguage = kernelSpec.language?.toLowerCase() || '';

    if (kernelLanguage === normalizedLanguage) {
      return kernelName;
    }
  }

  console.warn(`No kernel found for language '${language}', using default`);
  return specs.default || Object.keys(specs.kernelspecs)[0] || 'python3';
}

/**
 * Helper function to get a notebook widget by path or use the active one
 */
async function getNotebookWidget(
  notebookPath: string | null | undefined,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  background?: boolean
): Promise<NotebookPanel | null> {
  if (notebookPath) {
    let widget = docManager.findWidget(notebookPath);
    if (!widget && !background) {
      widget = docManager.openOrReveal(notebookPath);
    }

    if (widget && !(widget instanceof NotebookPanel)) {
      throw new Error(`Widget for ${notebookPath} is not a notebook panel`);
    }

    return widget ?? null;
  } else {
    return notebookTracker?.currentWidget || null;
  }
}

/**
 * Helper function to get a notebook context without widget
 */
async function getNotebookContext(
  manager: ServiceManager.IManager,
  path: string
): Promise<Context<INotebookModel>> {
  const factory = new NotebookModelFactory();
  const context = new Context({ manager, factory, path });
  await context.initialize(false);
  await context.ready;
  return context;
}

/**
 * Create a new Jupyter notebook with a kernel for the specified programming language
 */
function registerCreateNotebookCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  kernelSpecManager: KernelSpec.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:create-notebook',
    label: 'Create Notebook',
    caption:
      'Create a new Jupyter notebook with a kernel for the specified language',
    describedBy: {
      args: {
        language: {
          description:
            'The programming language for the notebook (e.g., python, r, julia, javascript, etc.). Will use system default if not specified.'
        },
        name: {
          description:
            'Optional name for the notebook file (without .ipynb extension)'
        }
      }
    },
    execute: async (args: any) => {
      const { language = null, name } = args;

      const kernel = await findKernelByLanguage(kernelSpecManager, language);

      if (!name) {
        throw new Error('A name must be provided to create a notebook');
      }

      const fileName = name.endsWith('.ipynb') ? name : `${name}.ipynb`;

      const notebookModel = await docManager.newUntitled({
        type: 'notebook'
      });

      // Rename to desired filename
      await docManager.services.contents.rename(notebookModel.path, fileName);

      // Create widget with specific kernel
      const notebook = docManager.createNew(fileName, 'default', {
        name: kernel
      });

      if (!(notebook instanceof DocumentWidget)) {
        throw new Error('Failed to create notebook widget');
      }

      await notebook.context.ready;
      await notebook.context.save();

      docManager.openOrReveal(fileName);

      return {
        success: true,
        message: `Successfully created notebook ${fileName} with ${kernel} kernel${language ? ` for ${language}` : ''}`,
        notebookPath: fileName,
        notebookName: fileName,
        kernel,
        language
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Add a cell to a notebook with optional content
 */
function registerAddCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  manager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:add-cell',
    label: 'Add Cell',
    caption: 'Add a cell to a notebook with optional content.',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        content: {
          description: 'Content to add to the cell'
        },
        cellType: {
          description: 'Type of cell to add (code, markdown, raw)'
        },
        position: {
          description: 'Position relative to current cell (above or below)'
        },
        background: {
          description: 'Whether to avoid opening the notebook widget'
        }
      }
    },
    execute: async (args: any) => {
      const {
        notebookPath,
        content = null,
        cellType = 'code',
        position = 'below',
        background = false
      } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );

      // Use a lock if the task must be executed in the background
      if (!currentWidget && background) {
        return Private.withLock(async () => {
          return await addCell(
            currentWidget,
            notebookPath,
            content,
            cellType,
            position,
            manager
          );
        });
      }

      // Otherwise execute it in the widget.
      return await addCell(
        currentWidget,
        notebookPath,
        content,
        cellType,
        position,
        manager
      );
    }
  };

  commands.addCommand(command.id, command);
}

async function addCell(
  currentWidget: NotebookPanel | null,
  notebookPath: string | null | undefined,
  content: string | null,
  cellType: string,
  position: string,
  manager?: ServiceManager.IManager
) {
  let notebook: Notebook | undefined;
  let context: Context<INotebookModel> | undefined;
  let model: INotebookModel | null = null;
  if (currentWidget) {
    notebook = currentWidget.content;
    model = notebook.model;
  } else {
    if (manager && notebookPath) {
      context = await getNotebookContext(manager, notebookPath);
      model = context.model;
    } else {
      return {
        success: false,
        error: notebookPath
          ? `Failed to open notebook at path: ${notebookPath}`
          : 'No active notebook and no notebook path provided'
      };
    }
  }

  if (!model) {
    return {
      success: false,
      error: 'No notebook model available'
    };
  }

  const shouldReplaceFirstCell =
    model.cells.length === 1 &&
    model.cells.get(0).sharedModel.getSource().trim() === '';

  if (shouldReplaceFirstCell) {
    model.sharedModel.deleteCell(0);
  }

  const newCellData = {
    cell_type: cellType,
    source: content || '',
    metadata: cellType === 'code' ? { trusted: true } : {}
  };

  model.sharedModel.addCell(newCellData);

  // Render the markdown cell if the widget is opened
  if (notebook && cellType === 'markdown' && content) {
    const cellIndex = model.cells.length - 1;
    const cellWidget = notebook.widgets[cellIndex];
    if (cellWidget && cellWidget instanceof MarkdownCell) {
      await cellWidget.ready;
      cellWidget.rendered = true;
    }
  }

  // Save the notebook and dispose of the context if there is no opened widget
  if (!currentWidget) {
    if (context) {
      await context.save();
      context.dispose();
    } else {
      return {
        success: false,
        message: 'The context is missing to save the Notebook'
      };
    }
  }

  return {
    success: true,
    message: `${cellType} cell added successfully`,
    content: content || '',
    cellType,
    position
  };
}

/**
 * Get information about a notebook including number of cells and active cell index
 */
function registerGetNotebookInfoCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  manager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:get-notebook-info',
    label: 'Get Notebook Info',
    caption:
      'Get information about a notebook including number of cells and active cell index',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        background: {
          description: 'Whether to avoid opening the notebook widget'
        }
      }
    },
    execute: async (args: any) => {
      const { background, notebookPath } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );

      let notebook: Notebook | undefined;
      let context: Context<INotebookModel> | undefined;
      let model: INotebookModel | null = null;
      if (currentWidget) {
        notebook = currentWidget.content;
        model = notebook.model;
      } else {
        if (manager && notebookPath) {
          context = await getNotebookContext(manager, notebookPath);
          model = context.model;
        } else {
          return {
            success: false,
            error: notebookPath
              ? `Failed to open notebook at path: ${notebookPath}`
              : 'No active notebook and no notebook path provided'
          };
        }
      }

      if (!model) {
        return {
          success: false,
          error: 'No notebook model available'
        };
      }

      const notebookName =
        currentWidget?.title.label ?? context?.localPath.split('/').pop();
      const path = currentWidget?.context.path ?? context?.path;
      const cellCount = model.cells.length;
      const activeCellIndex = notebook?.activeCellIndex;
      const activeCell = notebook?.activeCell;
      const activeCellType = activeCell?.model.type || 'unknown';

      return {
        success: true,
        notebookName,
        notebookPath: path,
        cellCount,
        activeCellIndex,
        activeCellType,
        isDirty: model.dirty
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Get information about a specific cell including its type, source content, and outputs
 */
function registerGetCellInfoCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  manager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:get-cell-info',
    label: 'Get Cell Info',
    caption:
      'Get information about a specific cell including its type, source content, and outputs',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        cellIndex: {
          description:
            'Index of the cell to get information for (0-based). If not provided, uses the currently active cell'
        },
        background: {
          description: 'Whether to avoid opening the notebook widget'
        }
      }
    },
    execute: async (args: any) => {
      const { background, notebookPath } = args;
      let { cellIndex } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );

      let notebook: Notebook | undefined;
      let model: INotebookModel | null = null;
      if (currentWidget) {
        notebook = currentWidget.content;
        model = notebook.model;
      } else {
        if (manager && notebookPath) {
          const context = await getNotebookContext(manager, notebookPath);
          model = context.model;
        } else {
          return {
            success: false,
            error: notebookPath
              ? `Failed to open notebook at path: ${notebookPath}`
              : 'No active notebook and no notebook path provided'
          };
        }
      }

      if (!model) {
        return {
          success: false,
          error: 'No notebook model available'
        };
      }

      if (cellIndex === undefined || cellIndex === null) {
        cellIndex = notebook?.activeCellIndex || -1;
      }

      if (cellIndex < 0 || cellIndex >= model.cells.length) {
        return {
          success: false,
          error: `Invalid cell index: ${cellIndex}. Notebook has ${model.cells.length} cells.`
        };
      }

      const cell = model.cells.get(cellIndex);
      const cellType = cell.type;
      const sharedModel = cell.sharedModel;
      const source = sharedModel.getSource();

      let outputs: any[] = [];
      if (cellType === 'code') {
        const rawOutputs = sharedModel.toJSON().outputs;
        outputs = Array.isArray(rawOutputs) ? rawOutputs : [];
      }

      return {
        success: true,
        cellId: cell.id,
        cellIndex,
        cellType,
        source,
        outputs,
        executionCount:
          cellType === 'code' ? (cell as any).executionCount : null
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Set the content of a specific cell and return both the previous and new content
 */
function registerSetCellContentCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  manager?: ServiceManager.IManager,
  diffMode: 'unified' | 'split' = 'unified'
): void {
  const command = {
    id: 'jupyterlab-ai-commands:set-cell-content',
    label: 'Set Cell Content',
    caption: 'Set the content of a specific cell',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        cellId: {
          description:
            'ID of the cell to modify. If provided, takes precedence over cellIndex'
        },
        cellIndex: {
          description:
            'Index of the cell to modify (0-based). Used if cellId is not provided. If neither is provided, targets the active cell'
        },
        content: {
          description: 'New content for the cell'
        },
        showDiff: {
          description:
            'Whether to show a diff view of the changes (default: true)'
        },
        background: {
          description: 'Whether to avoid opening the notebook widget'
        }
      }
    },
    execute: async (args: any) => {
      const {
        notebookPath,
        cellId,
        cellIndex,
        content,
        background,
        showDiff = true
      } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );

      // Use a lock if the task must be executed in the background
      if (!currentWidget && background) {
        return Private.withLock(async () => {
          return await setCellContent(
            currentWidget,
            notebookPath,
            content,
            showDiff ?? true,
            diffMode,
            commands,
            cellId,
            cellIndex,
            manager
          );
        });
      }

      // Otherwise execute it in the widget.
      return await setCellContent(
        currentWidget,
        notebookPath,
        content,
        showDiff ?? true,
        diffMode,
        commands,
        cellId,
        cellIndex,
        manager
      );
    }
  };

  commands.addCommand(command.id, command);
}

async function setCellContent(
  currentWidget: NotebookPanel | null,
  notebookPath: string | null | undefined,
  content: string,
  showDiff: boolean,
  diffMode: 'unified' | 'split' = 'unified',
  commands: CommandRegistry,
  cellId?: string,
  cellIndex?: number,
  manager?: ServiceManager.IManager
) {
  let notebook: Notebook | undefined;
  let context: Context<INotebookModel> | undefined;
  let model: INotebookModel | null = null;
  if (currentWidget) {
    notebook = currentWidget.content;
    model = notebook.model;
  } else {
    if (manager && notebookPath) {
      context = await getNotebookContext(manager, notebookPath);
      model = context.model;
    } else {
      return {
        success: false,
        error: notebookPath
          ? `Failed to open notebook at path: ${notebookPath}`
          : 'No active notebook and no notebook path provided'
      };
    }
  }

  const targetNotebookPath = currentWidget?.context.path ?? context?.path;

  if (!model) {
    return {
      success: false,
      error: 'No notebook model available'
    };
  }

  let targetCellIndex: number;
  if (cellId !== undefined && cellId !== null) {
    targetCellIndex = -1;
    for (let i = 0; i < model.cells.length; i++) {
      if (model.cells.get(i).id === cellId) {
        targetCellIndex = i;
        break;
      }
    }
    if (targetCellIndex === -1) {
      return {
        success: false,
        error: `Cell with ID '${cellId}' not found in notebook`
      };
    }
  } else if (cellIndex !== undefined && cellIndex !== null) {
    if (cellIndex < 0 || cellIndex >= model.cells.length) {
      return {
        success: false,
        error: `Invalid cell index: ${cellIndex}. Notebook has ${model.cells.length} cells.`
      };
    }
    targetCellIndex = cellIndex;
  } else {
    targetCellIndex = notebook?.activeCellIndex || -1;
    if (targetCellIndex === -1 || targetCellIndex >= model.cells.length) {
      return {
        success: false,
        error: 'No active cell or invalid active cell index'
      };
    }
  }

  const targetCell = model.cells.get(targetCellIndex);
  if (!targetCell) {
    return {
      success: false,
      error: `Cell at index ${targetCellIndex} not found`
    };
  }

  const sharedModel = targetCell.sharedModel;
  const previousContent = sharedModel.getSource();
  const previousCellType = targetCell.type;
  const retrievedCellId = targetCell.id;

  sharedModel.setSource(content);

  // Show diff only if there is a current widget.
  const shouldShowDiff = currentWidget && showDiff;
  if (shouldShowDiff && previousContent !== content) {
    const diffCommandId =
      diffMode === 'split' ? SPLIT_DIFF_COMMAND_ID : UNIFIED_DIFF_COMMAND_ID;

    void commands.execute(diffCommandId, {
      originalSource: previousContent,
      newSource: content,
      cellId: retrievedCellId,
      showActionButtons: true,
      openDiff: true,
      notebookPath: targetNotebookPath
    });
  }

  // Save the notebook and dispose of the context if there is no opened widget
  if (!currentWidget) {
    if (context) {
      await context.save();
      context.dispose();
    } else {
      return {
        success: false,
        message: 'The context is missing to save the Notebook'
      };
    }
  }

  return {
    success: true,
    message:
      cellId !== undefined && cellId !== null
        ? `Cell with ID '${cellId}' content replaced successfully`
        : cellIndex !== undefined && cellIndex !== null
          ? `Cell ${targetCellIndex} content replaced successfully`
          : 'Active cell content replaced successfully',
    notebookPath: targetNotebookPath,
    cellId: retrievedCellId,
    cellIndex: targetCellIndex,
    previousContent,
    previousCellType,
    newContent: content,
    wasActiveCell: cellId === undefined && cellIndex === undefined,
    diffShown: shouldShowDiff && previousContent !== content
  };
}

/**
 * Run a specific cell in the notebook by index
 */
function registerRunCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:run-cell',
    label: 'Run Cell',
    caption: 'Run a specific cell in the notebook by index',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        cellIndex: {
          description: 'Index of the cell to run (0-based)'
        },
        recordTiming: {
          description: 'Whether to record execution timing'
        }
      }
    },
    execute: async (args: any) => {
      const { notebookPath, cellIndex, recordTiming = true } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker
      );
      if (!currentWidget) {
        return {
          success: false,
          error: notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        };
      }

      const notebook = currentWidget.content;
      const model = notebook.model;

      if (!model) {
        return {
          success: false,
          error: 'No notebook model available'
        };
      }

      if (cellIndex < 0 || cellIndex >= model.cells.length) {
        return {
          success: false,
          error: `Invalid cell index: ${cellIndex}. Notebook has ${model.cells.length} cells.`
        };
      }

      const cellWidget = notebook.widgets[cellIndex];
      if (!cellWidget) {
        return {
          success: false,
          error: `Cell widget at index ${cellIndex} not found`
        };
      }

      try {
        if (cellWidget instanceof CodeCell) {
          const sessionCtx = currentWidget.sessionContext;
          await CodeCell.execute(cellWidget, sessionCtx, {
            recordTiming,
            deletedCells: model.deletedCells
          });

          const codeModel = cellWidget.model as ICodeCellModel;
          return {
            success: true,
            message: `Cell ${cellIndex} executed successfully`,
            cellIndex,
            executionCount: codeModel.executionCount,
            hasOutput: codeModel.outputs.length > 0
          };
        } else {
          return {
            success: true,
            message: `Cell ${cellIndex} is not a code cell, no execution needed`,
            cellIndex,
            cellType: cellWidget.model.type
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to execute cell: ${(error as Error).message}`,
          cellIndex
        };
      }
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Delete a specific cell from the notebook by index
 */
function registerDeleteCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  manager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:delete-cell',
    label: 'Delete Cell',
    caption: 'Delete a specific cell from the notebook by index',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        },
        cellIndex: {
          description: 'Index of the cell to delete (0-based)'
        },
        background: {
          description: 'Whether to avoid opening the notebook widget'
        }
      }
    },
    execute: async (args: any) => {
      const { background, notebookPath, cellIndex } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );

      // Use a lock if the task must be executed in the background
      if (!currentWidget && background) {
        return Private.withLock(async () => {
          return await deleteCell(
            currentWidget,
            notebookPath,
            cellIndex,
            manager
          );
        });
      }

      // Otherwise execute it in the widget.
      return await deleteCell(currentWidget, notebookPath, cellIndex, manager);
    }
  };

  commands.addCommand(command.id, command);
}

async function deleteCell(
  currentWidget: NotebookPanel | null,
  notebookPath: string | null | undefined,
  cellIndex: number,
  manager?: ServiceManager.IManager
) {
  let notebook: Notebook | undefined;
  let context: Context<INotebookModel> | undefined;
  let model: INotebookModel | null = null;
  if (currentWidget) {
    notebook = currentWidget.content;
    model = notebook.model;
  } else {
    if (manager && notebookPath) {
      context = await getNotebookContext(manager, notebookPath);
      model = context.model;
    } else {
      return {
        success: false,
        error: notebookPath
          ? `Failed to open notebook at path: ${notebookPath}`
          : 'No active notebook and no notebook path provided'
      };
    }
  }

  if (!model) {
    return {
      success: false,
      error: 'No notebook model available'
    };
  }

  if (cellIndex < 0 || cellIndex >= model.cells.length) {
    return {
      success: false,
      error: `Invalid cell index: ${cellIndex}. Notebook has ${model.cells.length} cells.`
    };
  }

  const targetCell = model.cells.get(cellIndex);
  if (!targetCell) {
    return {
      success: false,
      error: `Cell at index ${cellIndex} not found`
    };
  }

  model.sharedModel.deleteCell(cellIndex);

  // Save the notebook and dispose of the context if there is no opened widget
  if (!currentWidget) {
    if (context) {
      await context.save();
      context.dispose();
    } else {
      return {
        success: false,
        message: 'The context is missing to save the Notebook'
      };
    }
  }

  return {
    success: true,
    message: `Cell ${cellIndex} deleted successfully`,
    cellIndex,
    remainingCells: model.cells.length
  };
}

/**
 * Save a specific notebook to disk
 */
function registerSaveNotebookCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:save-notebook',
    label: 'Save Notebook',
    caption: 'Save a specific notebook to disk',
    describedBy: {
      args: {
        notebookPath: {
          description:
            'Path to the notebook file. If not provided, uses the currently active notebook'
        }
      }
    },
    execute: async (args: any) => {
      const { notebookPath } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker
      );
      if (!currentWidget) {
        return {
          success: false,
          error: notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        };
      }

      await currentWidget.context.save();

      return {
        success: true,
        message: 'Notebook saved successfully',
        notebookName: currentWidget.title.label,
        notebookPath: currentWidget.context.path
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Options for registering notebook commands
 */
export interface IRegisterNotebookCommandsOptions {
  commands: CommandRegistry;
  docManager: IDocumentManager;
  kernelSpecManager: KernelSpec.IManager;
  notebookTracker?: INotebookTracker;
  serviceManager?: ServiceManager.IManager;
  diffMode?: 'unified' | 'split';
}

/**
 * Register all notebook-related commands
 */
export function registerNotebookCommands(
  options: IRegisterNotebookCommandsOptions
): void {
  const {
    commands,
    docManager,
    kernelSpecManager,
    notebookTracker,
    serviceManager,
    diffMode = 'unified'
  } = options;

  registerCreateNotebookCommand(commands, docManager, kernelSpecManager);
  registerAddCellCommand(commands, docManager, notebookTracker, serviceManager);
  registerGetNotebookInfoCommand(
    commands,
    docManager,
    notebookTracker,
    serviceManager
  );
  registerGetCellInfoCommand(
    commands,
    docManager,
    notebookTracker,
    serviceManager
  );
  registerSetCellContentCommand(
    commands,
    docManager,
    notebookTracker,
    serviceManager,
    diffMode
  );
  registerRunCellCommand(commands, docManager, notebookTracker);
  registerDeleteCellCommand(
    commands,
    docManager,
    notebookTracker,
    serviceManager
  );
  registerSaveNotebookCommand(commands, docManager, notebookTracker);
}

namespace Private {
  // Mutex implemented with a promise chain, that ensure running the background tasks in
  // in order, waiting for each others.
  let _mutex: Promise<void> = Promise.resolve();

  export async function lock(): Promise<() => void> {
    let release!: () => void;
    const p = new Promise<void>(res => {
      release = res;
    });

    const previous = _mutex;
    // Chain the new promise after the previous one
    _mutex = previous.then(() => p);

    // Wait for the previous holder to finish
    await previous;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      // resolve this lock's promise to let the next waiter run
      release();
    };
  }

  export async function withLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await lock();
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
