import type { YNotebook } from '@jupyter/ydoc';
import {
  CodeCell,
  ICellModel,
  ICodeCellModel,
  MarkdownCell
} from '@jupyterlab/cells';
import { PathExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { Context, DocumentRegistry } from '@jupyterlab/docregistry';
import * as nbformat from '@jupyterlab/nbformat';
import {
  INotebookModel,
  INotebookTracker,
  NotebookModelFactory,
  NotebookPanel
} from '@jupyterlab/notebook';
import { KernelSpec, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';

import { findKernelByLanguage } from './kernel-utils';

/**
 * Command IDs for diff management (from jupyterlab-diff)
 */
const UNIFIED_DIFF_COMMAND_ID = 'jupyterlab-diff:unified-cell-diff';
const SPLIT_DIFF_COMMAND_ID = 'jupyterlab-diff:split-cell-diff';
const CELL_TYPE_VALUES = ['code', 'markdown', 'raw'] as const;
const CELL_POSITION_VALUES = ['above', 'below'] as const;
const DIFF_MODE_VALUES = ['unified', 'split'] as const;
const VALID_CELL_TYPES = new Set(CELL_TYPE_VALUES);
const VALID_CELL_POSITIONS = new Set(CELL_POSITION_VALUES);
const BACKGROUND_DESCRIPTION =
  'Whether to avoid activating the Notebook widget so as not to disturb the user (default: true)';

type CellExecutionStatus = 'ok' | 'error' | 'abort' | 'no-op';

function getCodeCellOutputs(cellModel: ICodeCellModel): nbformat.IOutput[] {
  return cellModel.toJSON().outputs ?? [];
}

function getErrorOutput(
  outputs: nbformat.IOutput[]
): nbformat.IError | undefined {
  return outputs.find(nbformat.isError);
}

/**
 * Helper function to get a notebook widget by path or use the active one
 */
async function getNotebookWidget(
  notebookPath: string | null | undefined,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  background?: boolean,
  createWidget = true
): Promise<NotebookPanel | null> {
  if (notebookPath) {
    let widget = docManager.findWidget(notebookPath);
    if (!widget && createWidget) {
      widget = docManager.openOrReveal(notebookPath, 'default', undefined, {
        activate: !(background ?? true)
      });
    }

    if (!(widget instanceof NotebookPanel) && createWidget) {
      throw new Error(`Widget for ${notebookPath} is not a notebook panel`);
    }
    await widget?.context.ready;

    return (widget as NotebookPanel) ?? null;
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
): Promise<DocumentRegistry.IContext<INotebookModel>> {
  const factory = new NotebookModelFactory();
  const context = new Context({ manager, factory, path });
  await context.initialize(false);
  await context.ready;
  return context;
}

function findCellIndexById(model: INotebookModel, cellId: string): number {
  for (let i = 0; i < model.cells.length; i++) {
    if (model.cells.get(i).id === cellId) {
      return i;
    }
  }

  return -1;
}

function getCellTarget(
  notebookModel: INotebookModel,
  cellId?: string | null,
  notebookPanel?: NotebookPanel | null
): { cell: ICellModel; cellIndex: number } {
  if (cellId !== undefined && cellId !== null) {
    const cellIndex = findCellIndexById(notebookModel, cellId);

    if (cellIndex === -1) {
      throw new Error(`Cell with ID '${cellId}' not found in notebook`);
    }

    const cell = notebookModel.cells.get(cellIndex);
    if (!cell) {
      throw new Error(`Cell with ID '${cellId}' not found in notebook`);
    }

    return { cell, cellIndex };
  }

  const notebook = notebookPanel?.content;
  const cellIndex = notebook?.activeCellIndex;
  if (
    cellIndex === undefined ||
    cellIndex === -1 ||
    cellIndex >= notebookModel.cells.length
  ) {
    throw new Error('No active cell or invalid active cell index');
  }

  const cell = notebookModel.cells.get(cellIndex);
  if (!cell) {
    throw new Error(`Cell at active index ${cellIndex} not found`);
  }

  return { cell, cellIndex };
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
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description:
              'Programming language for the notebook (for example python, r, julia, or javascript). If omitted, the default kernel is used.'
          },
          name: {
            type: 'string',
            description:
              'Name for the notebook file (without the .ipynb extension)'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        },
        required: ['name']
      }
    },
    execute: async (args: any) => {
      const { name, background, language = null } = args;

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
      const notebook = docManager.openOrReveal(
        fileName,
        'default',
        { name: kernel },
        {
          activate: !(background ?? true)
        }
      );

      if (!(notebook instanceof NotebookPanel)) {
        throw new Error('Failed to create notebook widget');
      }

      await notebook.context.ready;

      // Persist cell IDs by saving newly created notebooks as nbformat 4.5+.
      const model = notebook.context.model;
      const sharedModel = model.sharedModel as YNotebook;
      if (sharedModel.nbformat_minor < 5) {
        sharedModel.nbformat_minor = 5;
      }

      await notebook.context.save();

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
 * Add a cell to the current notebook with optional content
 */
function registerAddCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:add-cell',
    label: 'Add Cell',
    caption: 'Add a cell to the current notebook with optional content',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          referenceCellId: {
            type: 'string',
            description:
              'nbformat cell ID of the reference cell. If not provided, uses the currently active cell'
          },
          content: {
            type: 'string',
            description: 'Content to add to the cell'
          },
          cellType: {
            type: 'string',
            description: 'Type of cell to add',
            enum: [...CELL_TYPE_VALUES]
          },
          position: {
            type: 'string',
            description:
              'Position relative to the reference or active cell (above or below)',
            enum: [...CELL_POSITION_VALUES]
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        }
      }
    },
    execute: async (args: any) => {
      const {
        notebookPath,
        referenceCellId,
        background,
        content = null,
        cellType = 'code',
        position = 'below'
      } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );
      if (!currentWidget) {
        throw new Error(
          notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        );
      }

      const notebook = currentWidget.content;
      const model = currentWidget.context.model;

      if (!VALID_CELL_TYPES.has(cellType)) {
        throw new Error(
          `Invalid cell type: '${cellType}'. Expected one of: code, markdown, raw`
        );
      }

      if (!VALID_CELL_POSITIONS.has(position)) {
        throw new Error(
          `Invalid cell position: '${position}'. Expected one of: above, below`
        );
      }

      const shouldReplaceFirstCell =
        model.cells.length === 1 &&
        model.cells.get(0).sharedModel.getSource().trim() === '';

      let insertIndex = model.cells.length;
      if (shouldReplaceFirstCell) {
        model.sharedModel.deleteCell(0);
        insertIndex = 0;
      } else if (model.cells.length > 0) {
        const { cellIndex: referenceCellIndex } = getCellTarget(
          model,
          referenceCellId,
          currentWidget
        );

        insertIndex =
          position === 'above' ? referenceCellIndex : referenceCellIndex + 1;
      }

      const newCellData = {
        cell_type: cellType,
        source: content || '',
        metadata: cellType === 'code' ? { trusted: true } : {}
      };

      model.sharedModel.insertCell(insertIndex, newCellData);
      const newCellIndex = insertIndex;
      notebook.activeCellIndex = newCellIndex;
      const newCell = model.cells.get(newCellIndex);

      if (!newCell) {
        throw new Error('Failed to create notebook cell');
      }

      if (cellType === 'markdown' && content) {
        const cellWidget = notebook.widgets[newCellIndex];
        if (cellWidget && cellWidget instanceof MarkdownCell) {
          await cellWidget.ready;
          cellWidget.rendered = true;
        }
      }

      return {
        success: true,
        message: `${cellType} cell added successfully`,
        cellId: newCell.id,
        content: content || '',
        cellType,
        position
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Get information about a notebook including cell IDs and the active cell ID
 */
function registerGetNotebookInfoCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  serviceManager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:get-notebook-info',
    label: 'Get Notebook Info',
    caption:
      'Get information about a notebook including cell IDs and the active cell ID',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          },
          createWidget: {
            type: 'boolean',
            description:
              'Whether to open the Notebook widget if it is not opened. Default to false to avoid unnecessary disruption'
          }
        }
      }
    },
    execute: async (args: any) => {
      const { notebookPath, background, createWidget } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background,
        // Create the Notebook widget if explicitly requested or if the service manager is not available.
        (createWidget ?? false) || !serviceManager
      );
      let context = currentWidget?.context;
      if (!currentWidget) {
        if (createWidget) {
          throw new Error(
            notebookPath
              ? `Failed to open notebook at path: ${notebookPath}`
              : 'No active notebook and no notebook path provided'
          );
        } else if (serviceManager && notebookPath) {
          context = await getNotebookContext(serviceManager, notebookPath);
        } else {
          throw new Error(
            notebookPath
              ? `Failed to get the content of ${notebookPath}, the service manager is not available`
              : 'No active notebook and no notebook path provided'
          );
        }
      }

      if (!context) {
        throw new Error(`Failed to get the context of ${notebookPath}`);
      }

      const notebook = currentWidget?.content;
      const model = context.model;

      const cellCount = model.cells.length;
      const activeCell = notebook?.activeCell;
      const activeCellId = activeCell?.model.id || null;
      const activeCellType = activeCell?.model.type || 'unknown';
      const isDirty = model.dirty;
      const cells = Array.from({ length: cellCount }, (_, index) => {
        const cell = model.cells.get(index);

        return {
          cellId: cell.id,
          cellType: cell.type
        };
      });
      const notebookMetadata = model.metadata;

      if (!currentWidget) {
        context.dispose();
      }

      return {
        success: true,
        notebookName:
          currentWidget?.title.label ?? PathExt.basename(notebookPath),
        notebookPath: currentWidget?.context.path ?? notebookPath,
        cellCount,
        activeCellId,
        activeCellType,
        cells,
        notebookMetadata,
        isDirty
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
  serviceManager?: ServiceManager.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:get-cell-info',
    label: 'Get Cell Info',
    caption:
      'Get information about a specific cell including its type, source content, and outputs',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          cellId: {
            type: 'string',
            description:
              'nbformat cell ID of the cell to get information for. If not provided, uses the currently active cell'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          },
          createWidget: {
            type: 'boolean',
            description:
              'Whether to open the Notebook widget if it is not opened. Default to false to avoid unnecessary disruption'
          }
        }
      }
    },
    execute: async (args: any) => {
      const { notebookPath, cellId, background, createWidget } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background,
        // Create the Notebook widget if explicitly requested or if the service manager is not available.
        (createWidget ?? false) || !serviceManager
      );
      let context = currentWidget?.context;
      if (!currentWidget) {
        if (createWidget) {
          throw new Error(
            notebookPath
              ? `Failed to open notebook at path: ${notebookPath}`
              : 'No active notebook and no notebook path provided'
          );
        } else if (serviceManager && notebookPath) {
          context = await getNotebookContext(serviceManager, notebookPath);
        } else {
          throw new Error(
            notebookPath
              ? `Failed to get the content of ${notebookPath}, the service manager is not available`
              : 'No active notebook and no notebook path provided'
          );
        }
      }

      if (!context) {
        throw new Error(`Failed to get the context of ${notebookPath}`);
      }

      const model = context.model;
      const { cell } = getCellTarget(model, cellId, currentWidget);
      const cellType = cell.type;
      const sharedModel = cell.sharedModel;
      const source = sharedModel.getSource();

      let outputs: any[] = [];
      if (cellType === 'code') {
        const rawOutputs = sharedModel.toJSON().outputs;
        outputs = Array.isArray(rawOutputs) ? rawOutputs : [];
      }

      if (!currentWidget) {
        context.dispose();
      }

      return {
        success: true,
        cellId: cell.id,
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
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:set-cell-content',
    label: 'Set Cell Content',
    caption: 'Set the content of a specific cell',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          cellId: {
            type: 'string',
            description:
              'nbformat cell ID of the cell to modify. If not provided, targets the currently active cell'
          },
          content: {
            type: 'string',
            description: 'New content for the cell'
          },
          showDiff: {
            type: 'boolean',
            description:
              'Whether to show a diff view of the changes (default: true)'
          },
          diffMode: {
            type: 'string',
            description: 'Display mode for the diff view',
            enum: [...DIFF_MODE_VALUES]
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        },
        required: ['content']
      }
    },
    execute: async (args: any) => {
      const {
        notebookPath,
        cellId,
        content,
        background,
        showDiff = true,
        diffMode = 'unified'
      } = args;

      const notebookWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );
      if (!notebookWidget) {
        throw new Error(
          notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        );
      }

      const targetNotebookPath = notebookWidget.context.path;
      const { cell: targetCell } = getCellTarget(
        notebookWidget.context.model,
        cellId,
        notebookWidget
      );

      const sharedModel = targetCell.sharedModel;
      const previousContent = sharedModel.getSource();
      const previousCellType = targetCell.type;
      const retrievedCellId = targetCell.id;

      sharedModel.setSource(content);

      const shouldShowDiff = showDiff ?? true;
      if (shouldShowDiff && previousContent !== content) {
        const diffCommandId =
          diffMode === 'split'
            ? SPLIT_DIFF_COMMAND_ID
            : UNIFIED_DIFF_COMMAND_ID;

        void commands.execute(diffCommandId, {
          originalSource: previousContent,
          newSource: content,
          cellId: retrievedCellId,
          showActionButtons: true,
          openDiff: true,
          notebookPath: targetNotebookPath
        });
      }

      return {
        success: true,
        message:
          cellId !== undefined && cellId !== null
            ? `Cell with ID '${cellId}' content replaced successfully`
            : 'Active cell content replaced successfully',
        notebookPath: targetNotebookPath,
        cellId: retrievedCellId,
        previousContent,
        previousCellType,
        newContent: content,
        wasActiveCell: cellId === undefined || cellId === null,
        diffShown: shouldShowDiff && previousContent !== content
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Run a specific cell in the notebook by nbformat cell ID
 */
function registerRunCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:run-cell',
    label: 'Run Cell',
    caption: 'Run a specific cell in the notebook by nbformat cell ID',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          cellId: {
            type: 'string',
            description: 'nbformat cell ID of the cell to run'
          },
          recordTiming: {
            type: 'boolean',
            description: 'Whether to record execution timing (default: true)'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        },
        required: ['cellId']
      }
    },
    execute: async (args: any) => {
      const { notebookPath, cellId, background, recordTiming = true } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );
      if (!currentWidget) {
        throw new Error(
          notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        );
      }

      const notebook = currentWidget.content;
      const model = currentWidget.context.model;
      const { cellIndex: targetCellIndex } = getCellTarget(
        model,
        cellId,
        currentWidget
      );
      const cellWidget = notebook.widgets[targetCellIndex];
      if (!cellWidget) {
        throw new Error(`Cell widget with ID '${cellId}' not found`);
      }

      if (cellWidget instanceof CodeCell) {
        const codeModel = cellWidget.model as ICodeCellModel;
        const source = codeModel.sharedModel.getSource();
        if (!source.trim()) {
          return {
            success: true,
            status: 'no-op',
            message: `Cell with ID '${cellId}' is empty, no execution needed`,
            cellId,
            cellType: codeModel.type,
            executionCount: codeModel.executionCount,
            outputs: [],
            hasOutput: false
          };
        }

        const sessionCtx = currentWidget.sessionContext;
        await sessionCtx.ready;

        if (!sessionCtx.session?.kernel) {
          return {
            success: false,
            status: 'error',
            message: `Cell with ID '${cellId}' cannot be executed without an active kernel`,
            cellId,
            cellType: codeModel.type,
            executionCount: codeModel.executionCount,
            outputs: [],
            hasOutput: false,
            errorName: 'MissingKernel',
            errorValue: 'No active kernel is attached to the notebook session'
          };
        }

        try {
          const reply = await CodeCell.execute(cellWidget, sessionCtx, {
            recordTiming,
            deletedCells: model.deletedCells
          });

          const outputs = getCodeCellOutputs(codeModel);
          const errorOutput = getErrorOutput(outputs);
          const replyContent = reply?.content;
          let status: CellExecutionStatus = replyContent?.status ?? 'no-op';
          let errorName: string | undefined;
          let errorValue: string | undefined;
          let traceback: string[] | undefined;

          if (replyContent?.status === 'error') {
            errorName = replyContent.ename;
            errorValue = replyContent.evalue;
            traceback = replyContent.traceback;
          } else if (errorOutput) {
            status = 'error';
            errorName = errorOutput.ename;
            errorValue = errorOutput.evalue;
            traceback = errorOutput.traceback;
          }

          return {
            success: status === 'ok' || status === 'no-op',
            status,
            message:
              status === 'ok'
                ? `Cell with ID '${cellId}' executed successfully`
                : status === 'abort'
                  ? `Cell with ID '${cellId}' execution was aborted`
                  : status === 'no-op'
                    ? `Cell with ID '${cellId}' did not produce an execution request`
                    : `Cell with ID '${cellId}' execution failed`,
            cellId,
            cellType: codeModel.type,
            executionCount: codeModel.executionCount,
            outputs,
            hasOutput: outputs.length > 0,
            errorName,
            errorValue,
            traceback
          };
        } catch (error) {
          const outputs = getCodeCellOutputs(codeModel);
          const errorOutput = getErrorOutput(outputs);
          const errorValue =
            error instanceof Error ? error.message : String(error);

          return {
            success: false,
            status: 'error',
            message: `Cell with ID '${cellId}' execution failed`,
            cellId,
            cellType: codeModel.type,
            executionCount: codeModel.executionCount,
            outputs,
            hasOutput: outputs.length > 0,
            errorName: errorOutput?.ename || 'ExecutionError',
            errorValue: errorOutput?.evalue || errorValue,
            traceback: errorOutput?.traceback
          };
        }
      } else {
        return {
          success: true,
          status: 'no-op',
          message: `Cell with ID '${cellId}' is not a code cell, no execution needed`,
          cellId,
          cellType: cellWidget.model.type,
          executionCount: null,
          outputs: [],
          hasOutput: false
        };
      }
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Delete a specific cell from the notebook by nbformat cell ID
 */
function registerDeleteCellCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:delete-cell',
    label: 'Delete Cell',
    caption: 'Delete a specific cell from the notebook by nbformat cell ID',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          cellId: {
            type: 'string',
            description: 'nbformat cell ID of the cell to delete'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        },
        required: ['cellId']
      }
    },
    execute: async (args: any) => {
      const { notebookPath, cellId, background } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );
      if (!currentWidget) {
        throw new Error(
          notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        );
      }

      const model = currentWidget.context.model;
      const { cellIndex: targetCellIndex } = getCellTarget(
        model,
        cellId,
        currentWidget
      );

      model.sharedModel.deleteCell(targetCellIndex);

      return {
        success: true,
        message: `Cell with ID '${cellId}' deleted successfully`,
        cellId,
        remainingCells: model.cells.length
      };
    }
  };

  commands.addCommand(command.id, command);
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
        type: 'object',
        properties: {
          notebookPath: {
            type: 'string',
            description:
              'Path to the notebook file. If not provided, uses the currently active notebook'
          },
          background: {
            type: 'boolean',
            description: BACKGROUND_DESCRIPTION
          }
        }
      }
    },
    execute: async (args: any) => {
      const { notebookPath, background } = args;

      const currentWidget = await getNotebookWidget(
        notebookPath,
        docManager,
        notebookTracker,
        background
      );
      if (!currentWidget) {
        throw new Error(
          notebookPath
            ? `Failed to open notebook at path: ${notebookPath}`
            : 'No active notebook and no notebook path provided'
        );
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
  serviceManager: ServiceManager.IManager;
  notebookTracker?: INotebookTracker;
}

/**
 * Register all notebook-related commands
 */
export function registerNotebookCommands(
  options: IRegisterNotebookCommandsOptions
): void {
  const { commands, docManager, serviceManager, notebookTracker } = options;

  registerCreateNotebookCommand(
    commands,
    docManager,
    serviceManager.kernelspecs
  );
  registerAddCellCommand(commands, docManager, notebookTracker);
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
  registerSetCellContentCommand(commands, docManager, notebookTracker);
  registerRunCellCommand(commands, docManager, notebookTracker);
  registerDeleteCellCommand(commands, docManager, notebookTracker);
  registerSaveNotebookCommand(commands, docManager, notebookTracker);
}
