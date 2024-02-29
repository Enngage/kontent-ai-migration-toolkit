import { ImportToolkit } from '../../lib/toolkit/import-toolkit.class.js';
import { ItemJsonProcessorService } from '../../lib/file-processor/index.js';

const run = async () => {
    const importToolkit = new ImportToolkit({
        sourceType: 'file',
        log: (data) => {
            console.log(`${data.type}: ${data.message}`);
        },
        environmentId: '<id>',
        managementApiKey: '<mapiKey>',
        skipFailedItems: false,
        // be careful when filtering data to import because you might break data consistency.
        // for example, it might not be possible to import language variant without first importing content item and so on.
        canImport: {
            asset: (item) => true, // all assets will be imported
            contentItem: (item) => true // all content items will be imported,
        },
        items: {
            filename: 'items-export.json',
            formatService: new ItemJsonProcessorService()
        }
    });

    await importToolkit.importAsync();
};

run();
