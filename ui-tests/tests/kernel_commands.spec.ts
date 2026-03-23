import { expect, test } from '@jupyterlab/galata';
import { executeCommand } from './utils/commands';

const COMMANDS = {
  executeInKernel: 'jupyterlab-ai-commands:execute-in-kernel',
  shutdownKernel: 'jupyterlab-ai-commands:shutdown-kernel',
  startKernel: 'jupyterlab-ai-commands:start-kernel'
} as const;

test.describe('Kernel Commands', () => {
  test.use({ serverFiles: 'only-on-failure' });

  test('should reject invalid kernel selection', async ({ page }) => {
    await expect(
      executeCommand(page, COMMANDS.startKernel, {
        language: 'definitely-not-a-real-language'
      })
    ).rejects.toThrow(
      "No kernel found for language 'definitely-not-a-real-language'"
    );

    await expect(
      executeCommand(page, COMMANDS.startKernel, {
        kernelName: 'definitely-not-a-real-kernel'
      })
    ).rejects.toThrow(
      "No kernel spec found with name 'definitely-not-a-real-kernel'"
    );
  });

  test('should preserve clear-output semantics in kernel execution results', async ({
    page
  }) => {
    let kernelId: string | undefined;

    try {
      const startResult = await executeCommand(page, COMMANDS.startKernel, {
        language: 'python'
      });

      expect(startResult.success).toBe(true);
      kernelId = startResult.kernelId;

      const executionResult = await executeCommand(
        page,
        COMMANDS.executeInKernel,
        {
          kernelId,
          code: [
            'from IPython.display import clear_output',
            'print("first")',
            'clear_output(wait=True)',
            'print("second")'
          ].join('\n')
        }
      );

      expect(executionResult.success).toBe(true);
      expect(executionResult.status).toBe('ok');
      expect(executionResult.message).toBe(
        'Kernel execution completed successfully'
      );
      expect(executionResult.kernelId).toBe(kernelId);
      expect(executionResult.outputCount).toBe(1);
      expect(executionResult.outputs).toHaveLength(1);
      expect(executionResult.outputs[0].output_type).toBe('stream');
      expect(executionResult.outputs[0].text.trim()).toBe('second');
    } finally {
      // Always shut down the kernel so failed assertions do not leak sessions.
      if (kernelId) {
        const shutdownResult = await executeCommand(
          page,
          COMMANDS.shutdownKernel,
          {
            kernelId
          }
        );

        expect(shutdownResult.success).toBe(true);
      }
    }
  });

  test('should return execution errors in the command payload', async ({
    page
  }) => {
    let kernelId: string | undefined;

    try {
      const startResult = await executeCommand(page, COMMANDS.startKernel, {
        language: 'python'
      });

      expect(startResult.success).toBe(true);
      kernelId = startResult.kernelId;

      const executionResult = await executeCommand(
        page,
        COMMANDS.executeInKernel,
        {
          kernelId,
          code: 'raise ValueError("boom")'
        }
      );

      expect(executionResult.success).toBe(false);
      expect(executionResult.status).toBe('error');
      expect(executionResult.message).toBe('Kernel execution failed');
      expect(executionResult.kernelId).toBe(kernelId);
      expect(executionResult.outputCount).toBe(executionResult.outputs.length);
      expect(executionResult.errorName).toBe('ValueError');
      expect(executionResult.errorValue).toContain('boom');
      expect(executionResult.traceback.length).toBeGreaterThan(0);
      expect(
        executionResult.outputs.some(
          (output: any) => output.output_type === 'error'
        )
      ).toBe(true);
    } finally {
      // Always shut down the kernel so failed assertions do not leak sessions.
      if (kernelId) {
        const shutdownResult = await executeCommand(
          page,
          COMMANDS.shutdownKernel,
          {
            kernelId
          }
        );

        expect(shutdownResult.success).toBe(true);
      }
    }
  });
});
