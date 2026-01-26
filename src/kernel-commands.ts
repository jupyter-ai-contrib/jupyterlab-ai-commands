import { Kernel, KernelSpec } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';

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
        language: {
          description:
            'The programming language for the kernel (e.g., python, r, julia). If not provided, uses system default.'
        },
        kernelName: {
          description:
            'The specific kernel spec name to use (e.g., python3, ir). If provided, takes precedence over language.'
        }
      }
    },
    execute: async (args: any) => {
      const { language, kernelName } = args;

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
        kernelId: {
          description: 'The ID of the kernel to execute code in'
        },
        code: {
          description: 'The code to execute'
        },
        silent: {
          description:
            'If true, signals the kernel to execute the code quietly without broadcasting output (default: false)'
        },
        storeHistory: {
          description:
            'If true, the code will be stored in the kernel execution history (default: true)'
        },
        stopOnError: {
          description:
            'If true, abort the execution queue on an error (default: false)'
        }
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

      const outputs: any[] = [];
      let executionCount: number | null = null;
      let status: string = 'ok';
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

      future.onIOPub = (msg: any) => {
        const msgType = msg.header.msg_type;
        const content = msg.content;

        if (msgType === 'stream') {
          outputs.push({
            output_type: 'stream',
            name: content.name,
            text: content.text
          });
        } else if (msgType === 'display_data') {
          outputs.push({
            output_type: 'display_data',
            data: content.data,
            metadata: content.metadata
          });
        } else if (msgType === 'execute_result') {
          outputs.push({
            output_type: 'execute_result',
            data: content.data,
            metadata: content.metadata,
            execution_count: content.execution_count
          });
        } else if (msgType === 'error') {
          outputs.push({
            output_type: 'error',
            ename: content.ename,
            evalue: content.evalue,
            traceback: content.traceback
          });
        }
      };

      const reply = await future.done;

      if (reply.content.status === 'ok') {
        executionCount = (reply.content as any).execution_count;
      } else if (reply.content.status === 'error') {
        status = 'error';
        const errorContent = reply.content as any;
        errorName = errorContent.ename;
        errorValue = errorContent.evalue;
        traceback = errorContent.traceback;
      } else if (reply.content.status === 'abort') {
        status = 'abort';
      }

      kernel.dispose();

      const result: any = {
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
        kernelId: {
          description: 'The ID of the kernel to shutdown'
        }
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
      args: {}
    },
    execute: async () => {
      await kernelManager.ready;
      await kernelManager.refreshRunning();

      const kernels: any[] = [];
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
}
