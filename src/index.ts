import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDocumentManager } from '@jupyterlab/docmanager';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { registerFileCommands } from './file-commands';
import { registerKernelCommands } from './kernel-commands';
import { registerNotebookCommands } from './notebook-commands';

/**
 * Initialization data for the jupyterlab-ai-commands extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ai-commands:plugin',
  description: 'A set of commands for AI in JupyterLab',
  autoStart: true,
  requires: [IDocumentManager],
  optional: [IEditorTracker, INotebookTracker, ISettingRegistry, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    editorTracker?: IEditorTracker,
    notebookTracker?: INotebookTracker,
    settingRegistry?: ISettingRegistry,
    translator?: ITranslator
  ) => {
    console.log('JupyterLab extension jupyterlab-ai-commands is activated!');

    const { commands, serviceManager } = app;

    const trans = (translator ?? nullTranslator).load('jupyterlab_ai_commands');

    registerFileCommands({
      commands,
      docManager,
      trans,
      editorTracker,
      serviceManager
    });

    registerNotebookCommands({
      commands,
      docManager,
      serviceManager,
      notebookTracker,
      trans
    });

    const kernelManager = app.serviceManager.kernels;
    registerKernelCommands({
      commands,
      kernelManager,
      kernelSpecManager: serviceManager.kernelspecs,
      trans
    });

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log(
            'jupyterlab-ai-commands settings loaded:',
            settings.composite
          );
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for jupyterlab-ai-commands.',
            reason
          );
        });
    }
  }
};

export default plugin;
