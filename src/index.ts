import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDocumentManager } from '@jupyterlab/docmanager';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

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
  optional: [IEditorTracker, INotebookTracker, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    editorTracker?: IEditorTracker,
    notebookTracker?: INotebookTracker,
    settingRegistry?: ISettingRegistry
  ) => {
    console.log('JupyterLab extension jupyterlab-ai-commands is activated!');

    const { commands, serviceManager } = app;

    registerFileCommands({
      commands,
      docManager,
      editorTracker,
      serviceManager
    });

    registerNotebookCommands({
      commands,
      docManager,
      serviceManager,
      notebookTracker
    });

    const kernelManager = app.serviceManager.kernels;
    registerKernelCommands({
      commands,
      kernelManager,
      kernelSpecManager: serviceManager.kernelspecs
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
