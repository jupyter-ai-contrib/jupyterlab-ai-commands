import { Kernel, KernelMessage, KernelSpec } from '@jupyterlab/services';
import * as nbformat from '@jupyterlab/nbformat';
import { CommandRegistry } from '@lumino/commands';

/**
 * Information about a running kernel
 */
type KernelListItem = Pick<
  Kernel.IModel,
  'id' | 'name' | 'execution_state' | 'last_activity' | 'connections'
>;

/**
 * Information about a kernel spec
 */
interface IKernelSpecInfo {
  name: string;
  display_name: KernelSpec.ISpecModel['display_name'];
  language: KernelSpec.ISpecModel['language'];
}

/**
 * Kernel execution status
 */
type KernelExecutionStatus = 'ok' | 'error' | 'abort';

/**
 * Kernel execution output format (nbformat)
 */
type KernelExecutionOutput = nbformat.IOutput;

/**
 * Result of kernel code execution
 */
interface IKernelExecutionResult {
  success: boolean;
  status: KernelExecutionStatus;
  executionCount: nbformat.ExecutionCount;
  outputs: KernelExecutionOutput[];
  errorName?: string;
  errorValue?: string;
  traceback?: string[];
}

/**
 * Find a kernel by language, returning the kernel spec name
 */
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
 * Start a new kernel with the specified language or kernel name
 */
function registerStartKernelCommand(
  commands: CommandRegistry,
  kernelManager: Kernel.IManager,
  kernelSpecManager: KernelSpec.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:start-kernel',
    label: 'Start Kernel',
    caption: 'Start a new kernel with the specified language or kernel name',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description:
              'The programming language for the kernel (e.g., python, r, julia). If not provided, uses system default.'
          },
          kernelName: {
            type: 'string',
            description:
              'The specific kernel spec name to use (e.g., python3, ir). If provided, takes precedence over language.'
          }
        }
      }
    },
    execute: async (args: any) => {
      const { language = null, kernelName = null } = args;

      let targetKernelName: string;

      if (kernelName) {
        targetKernelName = kernelName;
      } else {
        targetKernelName = await findKernelByLanguage(
          kernelSpecManager,
          language
        );
      }

      await kernelManager.ready;

      const kernel = await kernelManager.startNew({
        name: targetKernelName
      });

      await kernel.info;

      return {
        success: true,
        message: 'Kernel started successfully',
        kernelId: kernel.id,
        kernelName: kernel.name,
        status: kernel.status
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Execute code in a running kernel and return the outputs
 */
function registerExecuteInKernelCommand(
  commands: CommandRegistry,
  kernelManager: Kernel.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:execute-in-kernel',
    label: 'Execute in Kernel',
    caption: 'Execute code in a running kernel and return the outputs',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          kernelId: {
            type: 'string',
            description: 'The ID of the kernel to execute code in'
          },
          code: {
            type: 'string',
            description: 'The code to execute'
          },
          silent: {
            type: 'boolean',
            description:
              'If true, signals the kernel to execute the code quietly without broadcasting output (default: false)'
          },
          storeHistory: {
            type: 'boolean',
            description:
              'If true, the code will be stored in the kernel execution history (default: true)'
          },
          stopOnError: {
            type: 'boolean',
            description:
              'If true, abort the execution queue on an error (default: false)'
          }
        },
        required: ['kernelId', 'code']
      }
    },
    execute: async (args: any) => {
      const {
        kernelId,
        code,
        silent = false,
        storeHistory = true,
        stopOnError = false
      } = args;

      if (!kernelId) {
        throw new Error('kernelId is required');
      }

      if (!code) {
        throw new Error('code is required');
      }

      await kernelManager.ready;

      let kernel: Kernel.IKernelConnection | undefined;
      for (const runningKernel of kernelManager.running()) {
        if (runningKernel.id === kernelId) {
          kernel = kernelManager.connectTo({ model: runningKernel });
          break;
        }
      }

      if (!kernel) {
        throw new Error(`No running kernel found with ID: ${kernelId}`);
      }

      const outputs: KernelExecutionOutput[] = [];
      let executionCount: number | null = null;
      let status: KernelExecutionStatus = 'ok';
      let errorName: string | undefined;
      let errorValue: string | undefined;
      let traceback: string[] | undefined;

      const future = kernel.requestExecute({
        code,
        silent,
        store_history: storeHistory,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: stopOnError
      });

      future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
        if (KernelMessage.isStreamMsg(msg)) {
          outputs.push({
            output_type: 'stream',
            name: msg.content.name,
            text: msg.content.text
          });
          return;
        }

        if (KernelMessage.isDisplayDataMsg(msg)) {
          outputs.push({
            output_type: 'display_data',
            data: msg.content.data,
            metadata: msg.content.metadata
          });
          return;
        }

        if (KernelMessage.isUpdateDisplayDataMsg(msg)) {
          outputs.push({
            output_type: 'update_display_data',
            data: msg.content.data,
            metadata: msg.content.metadata
          });
          return;
        }

        if (KernelMessage.isExecuteResultMsg(msg)) {
          outputs.push({
            output_type: 'execute_result',
            data: msg.content.data,
            metadata: msg.content.metadata,
            execution_count: msg.content.execution_count
          });
          return;
        }

        if (KernelMessage.isErrorMsg(msg)) {
          outputs.push({
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: msg.content.traceback
          });
        }
      };

      const reply = await future.done;

      if (reply.content.status === 'ok') {
        executionCount = (reply.content as KernelMessage.IExecuteReply)
          .execution_count;
      } else if (reply.content.status === 'error') {
        status = 'error';
        const errorContent = reply.content as KernelMessage.IReplyErrorContent;
        errorName = errorContent.ename;
        errorValue = errorContent.evalue;
        traceback = errorContent.traceback;
      } else if (reply.content.status === 'abort') {
        status = 'abort';
      }

      kernel.dispose();

      const result: IKernelExecutionResult = {
        success: status === 'ok',
        status,
        executionCount,
        outputs
      };

      if (status === 'error') {
        result.errorName = errorName;
        result.errorValue = errorValue;
        result.traceback = traceback;
      }

      return result;
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Shutdown a running kernel by ID
 */
function registerShutdownKernelCommand(
  commands: CommandRegistry,
  kernelManager: Kernel.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:shutdown-kernel',
    label: 'Shutdown Kernel',
    caption: 'Shutdown a running kernel by ID',
    describedBy: {
      args: {
        type: 'object',
        properties: {
          kernelId: {
            type: 'string',
            description: 'The ID of the kernel to shutdown'
          }
        },
        required: ['kernelId']
      }
    },
    execute: async (args: any) => {
      const { kernelId } = args;

      if (!kernelId) {
        throw new Error('kernelId is required');
      }

      await kernelManager.ready;
      await kernelManager.shutdown(kernelId);

      return {
        success: true,
        message: `Kernel ${kernelId} shutdown successfully`,
        kernelId
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * List all running kernels
 */
function registerListKernelsCommand(
  commands: CommandRegistry,
  kernelManager: Kernel.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:list-kernels',
    label: 'List Kernels',
    caption: 'List all running kernels',
    describedBy: {
      args: {
        type: 'object',
        properties: {}
      }
    },
    execute: async () => {
      await kernelManager.ready;
      await kernelManager.refreshRunning();

      const kernels: KernelListItem[] = [];
      for (const kernel of kernelManager.running()) {
        kernels.push({
          id: kernel.id,
          name: kernel.name,
          execution_state: kernel.execution_state,
          last_activity: kernel.last_activity,
          connections: kernel.connections
        });
      }

      return {
        success: true,
        kernels,
        count: kernels.length
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * List all available kernel specs
 */
function registerListKernelSpecsCommand(
  commands: CommandRegistry,
  kernelSpecManager: KernelSpec.IManager
): void {
  const command = {
    id: 'jupyterlab-ai-commands:list-kernelspecs',
    label: 'List Kernel Specs',
    caption: 'List all available kernel specs',
    describedBy: {
      args: {}
    },
    execute: async () => {
      await kernelSpecManager.ready;
      const specs = kernelSpecManager.specs;

      if (!specs || !specs.kernelspecs) {
        return {
          success: true,
          kernelspecs: [] as IKernelSpecInfo[],
          count: 0,
          default: null
        };
      }

      const kernelspecs: IKernelSpecInfo[] = [];
      for (const [name, spec] of Object.entries(specs.kernelspecs)) {
        if (!spec) {
          continue;
        }
        kernelspecs.push({
          name,
          display_name: spec.display_name,
          language: spec.language
        });
      }

      return {
        success: true,
        kernelspecs,
        count: kernelspecs.length,
        default: specs.default
      };
    }
  };

  commands.addCommand(command.id, command);
}

/**
 * Options for registering kernel commands
 */
export interface IRegisterKernelCommandsOptions {
  commands: CommandRegistry;
  kernelManager: Kernel.IManager;
  kernelSpecManager: KernelSpec.IManager;
}

/**
 * Register all kernel-related commands
 */
export function registerKernelCommands(
  options: IRegisterKernelCommandsOptions
): void {
  const { commands, kernelManager, kernelSpecManager } = options;

  registerStartKernelCommand(commands, kernelManager, kernelSpecManager);
  registerExecuteInKernelCommand(commands, kernelManager);
  registerShutdownKernelCommand(commands, kernelManager);
  registerListKernelsCommand(commands, kernelManager);
  registerListKernelSpecsCommand(commands, kernelSpecManager);
}
