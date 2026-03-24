import {
  CodeCell,
  ICellModel,
  ICodeCellModel,
  MarkdownCell
} from '@jupyterlab/cells';
import { IDocumentManager } from '@jupyterlab/docmanager';
import * as nbformat from '@jupyterlab/nbformat';
import {
  INotebookModel,
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';
import type { YNotebook } from '@jupyter/ydoc';
import { KernelSpec } from '@jupyterlab/services';
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
function getNotebookWidget(
  notebookPath: string | null | undefined,
  docManager: IDocumentManager,
  notebookTracker?: INotebookTracker,
  background?: boolean
): NotebookPanel | null {
  if (notebookPath) {
    let widget = docManager.findWidget(notebookPath);
    if (!widget) {
      widget = docManager.openOrReveal(notebookPath, 'default', undefined, {
        activate: !(background ?? true)
      });
    }

    if (!(widget instanceof NotebookPanel)) {
      throw new Error(`Widget for ${notebookPath} is not a notebook panel`);
    }

    return widget ?? null;
  } else {
    return notebookTracker?.currentWidget || null;
  }
}

function getNotebookModel(notebookPanel: NotebookPanel): INotebookModel {
  const model = notebookPanel.content.model;

  if (!model) {
    throw new Error('No notebook model available');
  }

  return model;
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
  notebookPanel: NotebookPanel,
  cellId?: string | null
): { cell: ICellModel; cellIndex: number } {
  const notebook = notebookPanel.content;
  const model = getNotebookModel(notebookPanel);

  if (cellId !== undefined && cellId !== null) {
    const cellIndex = findCellIndexById(model, cellId);

    if (cellIndex === -1) {
      throw new Error(`Cell with ID '${cellId}' not found in notebook`);
    }

    const cell = model.cells.get(cellIndex);
    if (!cell) {
      throw new Error(`Cell with ID '${cellId}' not found in notebook`);
    }

    return { cell, cellIndex };
  }

  const cellIndex = notebook.activeCellIndex;
  if (cellIndex === -1 || cellIndex >= model.cells.length) {
    throw new Error('No active cell or invalid active cell index');
  }

  const cell = model.cells.get(cellIndex);
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
      const model = getNotebookModel(notebook);
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

      const currentWidget = getNotebookWidget(
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
      const model = getNotebookModel(currentWidget);

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
          currentWidget,
          referenceCellId
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
  notebookTracker?: INotebookTracker
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
          }
        }
      }
    },
    execute: (args: any) => {
      const { notebookPath, background } = args;

      const currentWidget = getNotebookWidget(
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
      const model = getNotebookModel(currentWidget);

      const cellCount = model.cells.length;
      const activeCell = notebook.activeCell;
      const activeCellId = activeCell?.model.id || null;
      const activeCellType = activeCell?.model.type || 'unknown';
      const cells = Array.from({ length: cellCount }, (_, index) => {
        const cell = model.cells.get(index);

        return {
          cellId: cell.id,
          cellType: cell.type
        };
      });
      const notebookMetadata = model.metadata;

      return {
        success: true,
        notebookName: currentWidget.title.label,
        notebookPath: currentWidget.context.path,
        cellCount,
        activeCellId,
        activeCellType,
        cells,
        notebookMetadata,
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
  notebookTracker?: INotebookTracker
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
          }
        }
      }
    },
    execute: (args: any) => {
      const { notebookPath, cellId, background } = args;

      const currentWidget = getNotebookWidget(
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

      const { cell } = getCellTarget(currentWidget, cellId);
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
    execute: (args: any) => {
      const {
        notebookPath,
        cellId,
        content,
        background,
        showDiff = true,
        diffMode = 'unified'
      } = args;

      const notebookWidget = getNotebookWidget(
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
      const { cell: targetCell } = getCellTarget(notebookWidget, cellId);

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

      const currentWidget = getNotebookWidget(
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
      const model = getNotebookModel(currentWidget);
      const { cellIndex: targetCellIndex } = getCellTarget(
        currentWidget,
        cellId
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
    execute: (args: any) => {
      const { notebookPath, cellId, background } = args;

      const currentWidget = getNotebookWidget(
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

      const model = getNotebookModel(currentWidget);
      const { cellIndex: targetCellIndex } = getCellTarget(
        currentWidget,
        cellId
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

      const currentWidget = getNotebookWidget(
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
  kernelSpecManager: KernelSpec.IManager;
  notebookTracker?: INotebookTracker;
}

/**
 * Register all notebook-related commands
 */
export function registerNotebookCommands(
  options: IRegisterNotebookCommandsOptions
): void {
  const { commands, docManager, kernelSpecManager, notebookTracker } = options;

  registerCreateNotebookCommand(commands, docManager, kernelSpecManager);
  registerAddCellCommand(commands, docManager, notebookTracker);
  registerGetNotebookInfoCommand(commands, docManager, notebookTracker);
  registerGetCellInfoCommand(commands, docManager, notebookTracker);
  registerSetCellContentCommand(commands, docManager, notebookTracker);
  registerRunCellCommand(commands, docManager, notebookTracker);
  registerDeleteCellCommand(commands, docManager, notebookTracker);
  registerSaveNotebookCommand(commands, docManager, notebookTracker);
}
