import type { IJupyterLabPageFixture } from '@jupyterlab/galata';

export async function executeCommand<T = any>(
  page: IJupyterLabPageFixture,
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return page.evaluate(
    async ({ args, command }) => {
      await window.jupyterapp.started;
      return await window.jupyterapp.commands.execute(command, args);
    },
    { args: { background: false, ...args }, command }
  );
}
