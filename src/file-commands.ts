import { PathExt } from '@jupyterlab/coreutils';
import { CommandRegistry } from '@lumino/commands';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { DocumentWidget, IDocumentWidget } from '@jupyterlab/docregistry';
import { IEditorTracker } from '@jupyterlab/fileeditor';

/**
 * Command IDs for diff management (from jupyterlab-diff)
 */
const UNIFIED_FILE_DIFF_COMMAND_ID = 'jupyterlab-diff:unified-file-diff';

/**
 * Helper function to get a document widget by path or use the active one
 */
function getDocumentWidget(
  filepath: string,
  docManager: IDocumentManager,
  background?: boolean
): DocumentWidget {
  let widget = docManager.findWidget(filepath);
  if (!widget) {
    widget = docManager.openOrReveal(filepath, undefined, undefined, {
      activate: !(background ?? true)
    });
  }

  if (!(widget instanceof DocumentWidget)) {
    throw new Error(`Widget for ${filepath} is not a document widget`);
  }

  return widget;
}

/**
 * Create a new file of specified type (text, python, markdown, json, etc.)
 */
function registerCreateFileCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:create-file',
    label: 'Create File',
    caption: 'Create a new file of specified type',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          fileName: {
            type: 'string',
            description: 'Name of the file to create'
          },
          fileType: {
            type: 'string',
            description:
              'Type of file to create. Common examples: text, python, markdown, json, javascript, typescript, yaml, julia, r, csv'
          },
          content: {
            type: 'string',
            description: 'Initial content for the file (optional)'
          },
          cwd: {
            type: 'string',
            description: 'Directory where to create the file (optional)'
          },
          background: {
            type: 'boolean',
            description:
              'Whether to avoid activating the document widget so as not to disturb the user (default: true)'
          }
        },
        required: ['fileName']
      }
    },
    execute: async (args: any) => {
      const {
        fileName,
        cwd,
        background,
        content = '',
        fileType = 'text'
      } = args;

      const registeredFileType = docManager.registry.getFileType(fileType);
      const ext = registeredFileType?.extensions[0] || '.txt';

      const existingExt = PathExt.extname(fileName);
      const fullFileName = existingExt ? fileName : `${fileName}${ext}`;

      const fullPath = cwd ? `${cwd}/${fullFileName}` : fullFileName;

      const model = await docManager.services.contents.newUntitled({
        path: cwd || '',
        type: 'file',
        ext
      });

      let finalPath = model.path;
      if (model.name !== fullFileName) {
        const renamed = await docManager.services.contents.rename(
          model.path,
          fullPath
        );
        finalPath = renamed.path;
      }

      if (content) {
        await docManager.services.contents.save(finalPath, {
          type: 'file',
          format: 'text',
          content
        });
      }

      let opened = false;
      if (getDocumentWidget(finalPath, docManager, background)) {
        opened = true;
      }

      return {
        success: true,
        message: `${fileType} file '${fullFileName}' created and opened successfully`,
        fileName: fullFileName,
        filePath: finalPath,
        fileType,
        hasContent: !!content,
        opened
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Open a file in the editor
 */
function registerOpenFileCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:open-file',
    label: 'Open File',
    caption: 'Open a file in the editor',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to open'
          },
          background: {
            type: 'boolean',
            description:
              'Whether to avoid activating the document widget so as not to disturb the user (default: true)'
          }
        },
        required: ['filePath']
      }
    },
    execute: (args: any) => {
      const { filePath, background } = args;

      const widget = getDocumentWidget(filePath, docManager, background);

      if (!widget) {
        throw new Error(`Could not open file: ${filePath}`);
      }

      return {
        success: true,
        message: `File '${filePath}' opened successfully`,
        filePath,
        widgetId: widget.id
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Delete a file from the file system
 */
function registerDeleteFileCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:delete-file',
    label: 'Delete File',
    caption: 'Delete a file from the file system',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to delete'
          }
        },
        required: ['filePath']
      }
    },
    execute: async (args: any) => {
      const { filePath } = args;

      await docManager.services.contents.delete(filePath);

      return {
        success: true,
        message: `File '${filePath}' deleted successfully`,
        filePath
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Rename a file or move it to a different location
 */
function registerRenameFileCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:rename-file',
    label: 'Rename File',
    caption: 'Rename a file or move it to a different location',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          oldPath: {
            type: 'string',
            description: 'Current path of the file'
          },
          newPath: {
            type: 'string',
            description: 'New path/name for the file'
          }
        },
        required: ['oldPath', 'newPath']
      }
    },
    execute: async (args: any) => {
      const { oldPath, newPath } = args;

      await docManager.services.contents.rename(oldPath, newPath);

      return {
        success: true,
        message: `File renamed from '${oldPath}' to '${newPath}' successfully`,
        oldPath,
        newPath
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Copy a file to a new location
 */
function registerCopyFileCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:copy-file',
    label: 'Copy File',
    caption: 'Copy a file to a new location',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          sourcePath: {
            type: 'string',
            description: 'Path of the file to copy'
          },
          destinationPath: {
            type: 'string',
            description: 'Destination path for the copied file'
          }
        },
        required: ['sourcePath', 'destinationPath']
      }
    },
    execute: async (args: any) => {
      const { sourcePath, destinationPath } = args;

      await docManager.services.contents.copy(sourcePath, destinationPath);

      return {
        success: true,
        message: `File copied from '${sourcePath}' to '${destinationPath}' successfully`,
        sourcePath,
        destinationPath
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Navigate to a specific directory in the file browser
 */
function registerNavigateToDirectoryCommand(commands: CommandRegistry): void {
  const command = {
    id: 'jupyterlab-ai-commands:navigate-to-directory',
    label: 'Navigate to Directory',
    caption: 'Navigate to a specific directory in the file browser',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the directory to navigate to'
          }
        },
        required: ['path']
      }
    },
    execute: async (args: any) => {
      const { path } = args;

      await commands.execute('filebrowser:go-to-path', {
        path
      });

      return {
        success: true,
        message: `Navigated to directory '${path}' successfully`,
        path
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * List files and directories in a specific directory
 */
function registerListDirectoryCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:list-directory',
    label: 'List Directory',
    caption: 'List files and directories in a specific directory',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to the directory to list. If not provided, lists the root directory'
          },
          includeHidden: {
            type: 'boolean',
            description: 'Whether to include hidden files (default: false)'
          }
        }
      }
    },
    execute: async (args: any) => {
      const { path = '', includeHidden = false } = args;

      const contents = await docManager.services.contents.get(path, {
        content: true
      });

      if (contents.type !== 'directory') {
        throw new Error(`Path '${path}' is not a directory`);
      }

      const items = contents.content || [];
      const filteredItems = includeHidden
        ? items
        : items.filter((item: any) => !item.name.startsWith('.'));

      const formattedItems = filteredItems.map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size || 0,
        created: item.created,
        lastModified: item.last_modified,
        mimetype: item.mimetype || null,
        format: item.format || null
      }));

      const directories = formattedItems.filter(
        (item: any) => item.type === 'directory'
      );
      const files = formattedItems.filter(
        (item: any) => item.type !== 'directory'
      );

      return {
        success: true,
        message: `Listed ${formattedItems.length} items in directory '${path || '/'}'`,
        path: path || '/',
        totalItems: formattedItems.length,
        directories: directories.length,
        files: files.length,
        items: formattedItems,
        includeHidden
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Get information about a file including its path, name, extension, and content
 */
function registerGetFileInfoCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager,
  editorTracker?: IEditorTracker
): void {
  const command = {
    id: 'jupyterlab-ai-commands:get-file-info',
    label: 'Get File Info',
    caption: 'Get information about a file including its content',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description:
              'Path to the file to read. If not provided, uses the currently active file in the editor.'
          },
          background: {
            type: 'boolean',
            description:
              'Whether to avoid activating the document widget so as not to disturb the user (default: true)'
          }
        }
      }
    },
    execute: async (args: any) => {
      const { filePath, background } = args;

      let widget: IDocumentWidget | null = null;

      if (filePath) {
        widget = getDocumentWidget(filePath, docManager, background);

        if (!widget) {
          throw new Error(`Failed to open file at path: ${filePath}`);
        }
      } else {
        widget = editorTracker?.currentWidget ?? null;

        if (!widget) {
          throw new Error(
            'No active file in the editor and no file path provided'
          );
        }
      }

      if (!widget.context) {
        throw new Error('Widget is not a document');
      }

      await widget.context.ready;

      const model = widget.context.model;

      if (!model) {
        throw new Error('File model not available');
      }

      const sharedModel = model.sharedModel;
      const content = sharedModel.getSource();
      const resolvedFilePath = widget.context.path;
      const fileName = widget.title.label;
      const fileExtension = PathExt.extname(resolvedFilePath) || 'unknown';

      return {
        success: true,
        filePath: resolvedFilePath,
        fileName,
        fileExtension,
        content,
        isDirty: model.dirty,
        readOnly: model.readOnly,
        widgetType: widget.constructor.name
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Set or update the content of an existing file
 */
function registerSetFileContentCommand(
  commands: CommandRegistry,
  docManager: IDocumentManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:set-file-content',
    label: 'Set File Content',
    caption: 'Set or update the content of an existing file',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to update'
          },
          content: {
            type: 'string',
            description: 'The new content to set for the file'
          },
          save: {
            type: 'boolean',
            description:
              'Whether to save the file after updating (default: true)'
          },
          showDiff: {
            type: 'boolean',
            description:
              'Whether to show a diff view of the changes (default: true)'
          },
          background: {
            type: 'boolean',
            description:
              'Whether to avoid activating the document widget so as not to disturb the user (default: true)'
          }
        },
        required: ['filePath', 'content']
      }
    },
    execute: async (args: any) => {
      const {
        filePath,
        content,
        background,
        save = true,
        showDiff = true
      } = args;

      const widget = getDocumentWidget(filePath, docManager, background);

      if (!widget) {
        throw new Error(`Failed to open file at path: ${filePath}`);
      }

      await widget.context.ready;

      const model = widget.context.model;

      if (!model) {
        throw new Error('File model not available');
      }

      if (model.readOnly) {
        throw new Error('File is read-only and cannot be modified');
      }

      const sharedModel = model.sharedModel;
      const previousContent = sharedModel.getSource();

      sharedModel.setSource(content);

      const shouldShowDiff = showDiff ?? true;
      if (shouldShowDiff && previousContent !== content) {
        void commands.execute(UNIFIED_FILE_DIFF_COMMAND_ID, {
          originalSource: previousContent,
          newSource: content,
          filePath,
          showActionButtons: true
        });
      }

      if (save) {
        await widget.context.save();
      }

      return {
        success: true,
        filePath,
        fileName: widget.title.label,
        contentLength: content.length,
        saved: save,
        isDirty: model.dirty,
        diffShown: shouldShowDiff && previousContent !== content
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Options for registering file commands
 */
export interface IRegisterFileCommandsOptions {
  commands: CommandRegistry;
  docManager: IDocumentManager;
  editorTracker?: IEditorTracker;
}

/**
 * Register all file-related commands
 */
export function registerFileCommands(
  options: IRegisterFileCommandsOptions
): void {
  const { commands, docManager, editorTracker } = options;

  registerCreateFileCommand(commands, docManager);
  registerOpenFileCommand(commands, docManager);
  registerDeleteFileCommand(commands, docManager);
  registerRenameFileCommand(commands, docManager);
  registerCopyFileCommand(commands, docManager);
  registerNavigateToDirectoryCommand(commands);
  registerListDirectoryCommand(commands, docManager);
  registerGetFileInfoCommand(commands, docManager, editorTracker);
  registerSetFileContentCommand(commands, docManager);
}
