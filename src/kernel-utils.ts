import { KernelSpec } from '@jupyterlab/services';

/**
 * Find a kernel by language, returning the kernel spec name
 */
export async function findKernelByLanguage(
  kernelSpecManager: KernelSpec.IManager,
  language?: string | null
): Promise<string> {
  await kernelSpecManager.ready;
  const specs = kernelSpecManager.specs;

  if (!specs || !specs.kernelspecs) {
    throw new Error('No kernelspecs are available');
  }

  const availableKernelNames = Object.keys(specs.kernelspecs);
  if (availableKernelNames.length === 0) {
    throw new Error('No kernelspecs are available');
  }

  if (!language) {
    return specs.default || availableKernelNames[0];
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

  throw new Error(`No kernel found for language '${language}'`);
}
