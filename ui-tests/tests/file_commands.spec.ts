import { expect, test } from '@jupyterlab/galata';
import { executeCommand } from './utils/commands';

const COMMANDS = {
  copyFile: 'jupyterlab-ai-commands:copy-file',
  createFile: 'jupyterlab-ai-commands:create-file',
  getFileInfo: 'jupyterlab-ai-commands:get-file-info'
} as const;

test.describe('File Commands', () => {
  test.use({ serverFiles: 'only-on-failure' });

  test('should reject unknown file types', async ({ page, tmpPath }) => {
    await expect(
      executeCommand(page, COMMANDS.createFile, {
        cwd: tmpPath,
        fileName: 'unknown-type',
        fileType: 'definitely-not-a-file-type'
      })
    ).rejects.toThrow("Unknown file type: 'definitely-not-a-file-type'");
  });

  test('should create and copy a file to the exact destination path', async ({
    page,
    tmpPath
  }) => {
    const sourcePath = `${tmpPath}/copy-source.py`;
    const destinationPath = `${tmpPath}/copy-target.py`;

    const createResult = await executeCommand(page, COMMANDS.createFile, {
      cwd: tmpPath,
      fileName: 'copy-source',
      fileType: 'python',
      content: 'print("alpha")\n'
    });

    expect(createResult.success).toBe(true);
    expect(createResult.fileName).toBe('copy-source.py');
    expect(createResult.filePath).toBe(sourcePath);
    expect(createResult.hasContent).toBe(true);

    const copyResult = await executeCommand(page, COMMANDS.copyFile, {
      sourcePath,
      destinationPath
    });

    expect(copyResult.success).toBe(true);
    expect(copyResult.sourcePath).toBe(sourcePath);
    expect(copyResult.destinationPath).toBe(destinationPath);

    const sourceInfo = await executeCommand(page, COMMANDS.getFileInfo, {
      filePath: sourcePath
    });
    const copiedInfo = await executeCommand(page, COMMANDS.getFileInfo, {
      filePath: destinationPath
    });

    expect(sourceInfo.success).toBe(true);
    expect(copiedInfo.success).toBe(true);
    expect(copiedInfo.filePath).toBe(destinationPath);
    expect(copiedInfo.content).toBe(sourceInfo.content);
    expect(copiedInfo.content).toBe('print("alpha")\n');
  });
});
