import type { Locator } from '@playwright/test';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import { expect, test } from '@jupyterlab/galata';
import { executeCommand } from './utils/commands';

const COMMANDS = {
  addCell: 'jupyterlab-ai-commands:add-cell',
  createNotebook: 'jupyterlab-ai-commands:create-notebook',
  deleteCell: 'jupyterlab-ai-commands:delete-cell',
  getCellInfo: 'jupyterlab-ai-commands:get-cell-info',
  getNotebookInfo: 'jupyterlab-ai-commands:get-notebook-info',
  runCell: 'jupyterlab-ai-commands:run-cell',
  saveNotebook: 'jupyterlab-ai-commands:save-notebook',
  setCellContent: 'jupyterlab-ai-commands:set-cell-content'
} as const;

async function getCellInputLocator(
  page: IJupyterLabPageFixture,
  cellIndex: number
): Promise<Locator> {
  const locator = await page.notebook.getCellInputLocator(cellIndex);

  if (!locator) {
    throw new Error(`Could not find input locator for cell ${cellIndex}`);
  }

  return locator;
}

async function expectCellInputToContainText(
  page: IJupyterLabPageFixture,
  cellIndex: number,
  text: string
): Promise<void> {
  await expect(await getCellInputLocator(page, cellIndex)).toContainText(text);
}

test.describe('Notebook Commands', () => {
  test.use({ serverFiles: 'only-on-failure' });

  test('should create a notebook and add the expected cells', async ({
    page,
    tmpPath
  }) => {
    const notebookPath = `${tmpPath}/command-create-and-add.ipynb`;

    const createResult = await executeCommand(page, COMMANDS.createNotebook, {
      language: 'python',
      name: notebookPath
    });
    expect(createResult.success).toBe(true);

    const markdownCell = await executeCommand(page, COMMANDS.addCell, {
      cellType: 'markdown',
      content: '# Title\nBody',
      notebookPath
    });
    const codeCell = await executeCommand(page, COMMANDS.addCell, {
      cellType: 'code',
      content: 'value = 41\nvalue + 1',
      notebookPath
    });

    const notebookInfo = await executeCommand(page, COMMANDS.getNotebookInfo, {
      notebookPath
    });
    expect(notebookInfo.success).toBe(true);
    expect(notebookInfo.notebookPath).toBe(notebookPath);
    expect(notebookInfo.cellCount).toBe(2);
    expect(notebookInfo.cells).toEqual([
      { cellId: markdownCell.cellId, cellType: 'markdown' },
      { cellId: codeCell.cellId, cellType: 'code' }
    ]);
    expect(await page.notebook.getCellType(0)).toBe('markdown');
    expect(await page.notebook.getCellType(1)).toBe('code');
    await expectCellInputToContainText(page, 0, '# Title');
    await expectCellInputToContainText(page, 0, 'Body');
    await expectCellInputToContainText(page, 1, 'value = 41');
    await expectCellInputToContainText(page, 1, 'value + 1');

    const saveResult = await executeCommand(page, COMMANDS.saveNotebook, {
      notebookPath
    });
    expect(saveResult.success).toBe(true);
  });

  test('should insert cells relative to a reference cell id', async ({
    page,
    tmpPath
  }) => {
    const notebookPath = `${tmpPath}/command-add-cell-by-id.ipynb`;

    await executeCommand(page, COMMANDS.createNotebook, {
      language: 'python',
      name: notebookPath
    });

    const firstCell = await executeCommand(page, COMMANDS.addCell, {
      content: 'first = 1',
      notebookPath
    });
    const thirdCell = await executeCommand(page, COMMANDS.addCell, {
      content: 'third = 3',
      notebookPath
    });
    const secondCell = await executeCommand(page, COMMANDS.addCell, {
      referenceCellId: firstCell.cellId,
      content: 'second = 2',
      notebookPath,
      position: 'below'
    });
    const zerothCell = await executeCommand(page, COMMANDS.addCell, {
      referenceCellId: firstCell.cellId,
      content: 'zeroth = 0',
      notebookPath,
      position: 'above'
    });

    const notebookInfo = await executeCommand(page, COMMANDS.getNotebookInfo, {
      notebookPath
    });

    expect(notebookInfo.cellCount).toBe(4);
    expect(notebookInfo.cells.map((cell: any) => cell.cellId)).toEqual([
      zerothCell.cellId,
      firstCell.cellId,
      secondCell.cellId,
      thirdCell.cellId
    ]);

    await expectCellInputToContainText(page, 0, 'zeroth = 0');
    await expectCellInputToContainText(page, 1, 'first = 1');
    await expectCellInputToContainText(page, 2, 'second = 2');
    await expectCellInputToContainText(page, 3, 'third = 3');
  });

  test('should add cells below in correct order without referenceCellId', async ({
    page,
    tmpPath
  }) => {
    const notebookPath = `${tmpPath}/command-add-cell-order.ipynb`;

    await executeCommand(page, COMMANDS.createNotebook, {
      language: 'python',
      name: notebookPath
    });

    const cellA = await executeCommand(page, COMMANDS.addCell, {
      content: 'a = 1',
      notebookPath
    });
    const cellB = await executeCommand(page, COMMANDS.addCell, {
      content: 'b = 2',
      notebookPath
    });
    const cellC = await executeCommand(page, COMMANDS.addCell, {
      content: 'c = 3',
      notebookPath
    });

    const notebookInfo = await executeCommand(page, COMMANDS.getNotebookInfo, {
      notebookPath
    });

    expect(notebookInfo.cellCount).toBe(3);
    expect(notebookInfo.activeCellId).toBe(cellC.cellId);
    expect(notebookInfo.cells.map((cell: any) => cell.cellId)).toEqual([
      cellA.cellId,
      cellB.cellId,
      cellC.cellId
    ]);

    await expectCellInputToContainText(page, 0, 'a = 1');
    await expectCellInputToContainText(page, 1, 'b = 2');
    await expectCellInputToContainText(page, 2, 'c = 3');
  });

  test('should update notebook cells through set-cell-content', async ({
    page,
    tmpPath
  }) => {
    const notebookPath = `${tmpPath}/command-set-cell-content.ipynb`;

    await executeCommand(page, COMMANDS.createNotebook, {
      language: 'python',
      name: notebookPath
    });
    const codeCell = await executeCommand(page, COMMANDS.addCell, {
      content: 'before = 1',
      notebookPath
    });
    const markdownCell = await executeCommand(page, COMMANDS.addCell, {
      cellType: 'markdown',
      content: 'Old text',
      notebookPath
    });

    const codeUpdate = await executeCommand(page, COMMANDS.setCellContent, {
      cellId: codeCell.cellId,
      content: 'answer = 6 * 7',
      notebookPath,
      showDiff: false
    });
    const markdownUpdate = await executeCommand(page, COMMANDS.setCellContent, {
      cellId: markdownCell.cellId,
      content: '## Updated markdown',
      notebookPath,
      showDiff: false
    });

    expect(codeUpdate.cellId).toBe(codeCell.cellId);
    expect(codeUpdate.previousContent).toBe('before = 1');
    expect(markdownUpdate.cellId).toBe(markdownCell.cellId);
    expect(markdownUpdate.previousContent).toBe('Old text');

    expect(await page.notebook.getCellCount()).toBe(2);
    await expectCellInputToContainText(page, 0, 'answer = 6 * 7');
    await expectCellInputToContainText(page, 1, 'Updated markdown');

    const saveResult = await executeCommand(page, COMMANDS.saveNotebook, {
      notebookPath
    });
    expect(saveResult.success).toBe(true);
  });

  test('should run and delete notebook cells', async ({ page, tmpPath }) => {
    const notebookPath = `${tmpPath}/command-run-and-delete.ipynb`;

    await executeCommand(page, COMMANDS.createNotebook, {
      language: 'python',
      name: notebookPath
    });
    const alphaCell = await executeCommand(page, COMMANDS.addCell, {
      content: 'print("alpha")',
      notebookPath
    });
    const betaCell = await executeCommand(page, COMMANDS.addCell, {
      content: 'print("beta")',
      notebookPath
    });
    await page.locator('#jp-main-statusbar').getByText('Idle').waitFor();

    const runResult = await executeCommand(page, COMMANDS.runCell, {
      cellId: alphaCell.cellId,
      notebookPath
    });
    expect(runResult.success).toBe(true);
    expect(runResult.hasOutput).toBe(true);

    await page.waitForCondition(async () => {
      const output = await page.notebook.getCellTextOutput(0);
      return output?.[0]?.trim() === 'alpha';
    });

    const deleteResult = await executeCommand(page, COMMANDS.deleteCell, {
      cellId: betaCell.cellId,
      notebookPath
    });
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.remainingCells).toBe(1);
    expect(await page.notebook.getCellCount()).toBe(1);
    expect(await page.notebook.getCellType(0)).toBe('code');

    const notebookInfo = await executeCommand(page, COMMANDS.getNotebookInfo, {
      notebookPath
    });
    expect(notebookInfo.cells).toEqual([
      { cellId: alphaCell.cellId, cellType: 'code' }
    ]);

    const saveResult = await executeCommand(page, COMMANDS.saveNotebook, {
      notebookPath
    });
    expect(saveResult.success).toBe(true);

    const output = await page.notebook.getCellTextOutput(0);
    expect(output).not.toBeNull();
    expect(output?.[0].trim()).toBe('alpha');
  });
});
