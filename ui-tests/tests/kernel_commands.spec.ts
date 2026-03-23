import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import { expect, test } from '@jupyterlab/galata';
import { executeCommand } from './utils/commands';

const COMMANDS = {
  executeInKernel: 'jupyterlab-ai-commands:execute-in-kernel',
  shutdownKernel: 'jupyterlab-ai-commands:shutdown-kernel',
  startKernel: 'jupyterlab-ai-commands:start-kernel'
} as const;

async function expectKernelVisibleInRunningTab(
  page: IJupyterLabPageFixture
): Promise<void> {
  await page.sidebar.openTab('jp-running-sessions');
  await expect(page.sidebar.getContentPanelLocator('left')).toContainText(
    /Python 3|python3/
  );
}

async function shutdownKernelIfStarted(
  page: IJupyterLabPageFixture,
  kernelId?: string
): Promise<void> {
  if (!kernelId) {
    return;
  }

  try {
    await executeCommand(page, COMMANDS.shutdownKernel, {
      kernelId
    });
  } catch {
    // Best-effort cleanup. Do not hide the real test failure with a cleanup error.
  }
}

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
      await expectKernelVisibleInRunningTab(page);

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
      await shutdownKernelIfStarted(page, kernelId);
    }
  });

  test('should return update-display-data messages in kernel execution results', async ({
    page
  }) => {
    let kernelId: string | undefined;

    try {
      const startResult = await executeCommand(page, COMMANDS.startKernel, {
        language: 'python'
      });

      expect(startResult.success).toBe(true);
      kernelId = startResult.kernelId;
      await expectKernelVisibleInRunningTab(page);

      const executionResult = await executeCommand(
        page,
        COMMANDS.executeInKernel,
        {
          kernelId,
          code: [
            'from IPython.display import display, update_display',
            'display({"text/plain": "first"}, raw=True, display_id="demo")',
            'update_display({"text/plain": "second"}, raw=True, display_id="demo")'
          ].join('\n')
        }
      );

      expect(executionResult.success).toBe(true);
      expect(executionResult.status).toBe('ok');
      expect(executionResult.outputCount).toBe(2);
      expect(executionResult.outputs).toHaveLength(2);
      expect(executionResult.outputs[0].output_type).toBe('display_data');
      expect(executionResult.outputs[0].data['text/plain']).toBe('first');
      expect(executionResult.outputs[1].output_type).toBe(
        'update_display_data'
      );
      expect(executionResult.outputs[1].data['text/plain']).toBe('second');
    } finally {
      await shutdownKernelIfStarted(page, kernelId);
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
      await expectKernelVisibleInRunningTab(page);

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
      await shutdownKernelIfStarted(page, kernelId);
    }
  });
});
