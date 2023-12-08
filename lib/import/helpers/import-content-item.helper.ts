import { CollectionModels, ContentItemModels, ManagementClient } from '@kontent-ai/management-sdk';
import {
    IImportedData,
    extractErrorMessage,
    is404Error,
    logAction,
    logDebug,
    logErrorAndExit,
    logProcessingDebug
} from '../../core/index.js';
import { IParsedContentItem } from '../import.models.js';
import { ICategorizedParsedItems, parsedItemsHelper } from './parsed-items-helper.js';

export class ImportContentItemHelper {
    async importContentItemsAsync(data: {
        managementClient: ManagementClient;
        parsedContentItems: IParsedContentItem[];
        collections: CollectionModels.Collection[];
        importedData: IImportedData;
        config: {
            skipFailedItems: boolean;
        };
    }): Promise<ContentItemModels.ContentItem[]> {
        const preparedItems: ContentItemModels.ContentItem[] = [];
        let itemIndex: number = 0;

        const categorizedParsedItems: ICategorizedParsedItems = parsedItemsHelper.categorizeParsedItems(
            data.parsedContentItems
        );

        logAction('skip', 'contentItem', {
            title: `Skipping '${categorizedParsedItems.componentItems.length}' because they represent component items`
        });

        for (const importContentItem of categorizedParsedItems.regularItems) {
            itemIndex++;

            logProcessingDebug({
                index: itemIndex,
                totalCount: categorizedParsedItems.regularItems.length,
                itemType: 'contentItem',
                title: `'${importContentItem.system.name}' of type '${importContentItem.system.type}'`
            });

            await this.importContentItemAsync({
                managementClient: data.managementClient,
                collections: data.collections,
                importContentItem: importContentItem,
                importedData: data.importedData,
                parsedContentItems: data.parsedContentItems,
                preparedItems: preparedItems
            });

            try {
            } catch (error) {
                if (data.config.skipFailedItems) {
                    logDebug({
                        type: 'error',
                        message: `Failed to import content item`,
                        partA: importContentItem.system.codename,
                        partB: extractErrorMessage(error)
                    });
                } else {
                    throw error;
                }
            }
        }

        return preparedItems;
    }

    private async importContentItemAsync(data: {
        importContentItem: IParsedContentItem;
        managementClient: ManagementClient;
        parsedContentItems: IParsedContentItem[];
        collections: CollectionModels.Collection[];
        importedData: IImportedData;
        preparedItems: ContentItemModels.ContentItem[];
    }): Promise<void> {
        const preparedContentItemResult = await this.prepareContentItemAsync(
            data.managementClient,
            data.importContentItem,
            data.importedData
        );
        data.preparedItems.push(preparedContentItemResult.contentItem);

        // check if name should be updated, no other changes are supported
        if (preparedContentItemResult.status === 'itemAlreadyExists') {
            if (
                this.shouldUpdateContentItem(
                    data.importContentItem,
                    preparedContentItemResult.contentItem,
                    data.collections
                )
            ) {
                const upsertedContentItem = await data.managementClient
                    .upsertContentItem()
                    .byItemCodename(data.importContentItem.system.codename)
                    .withData({
                        name: data.importContentItem.system.name,
                        collection: {
                            codename: data.importContentItem.system.collection
                        }
                    })
                    .toPromise()
                    .then((m) => m.data);

                logAction('upsert', 'contentItem', {
                    title: `Upserting item '${upsertedContentItem.name}'`,
                    codename: data.importContentItem.system.codename
                });
            } else {
                logAction('skip', 'contentItem', {
                    title: `Item '${data.importContentItem.system.name}' already exists`,
                    codename: data.importContentItem.system.codename
                });
            }
        }
    }

    private shouldUpdateContentItem(
        parsedContentItem: IParsedContentItem,
        contentItem: ContentItemModels.ContentItem,
        collections: CollectionModels.Collection[]
    ): boolean {
        const collection = collections.find((m) => m.codename === parsedContentItem.system.collection);

        if (!collection) {
            logErrorAndExit({
                message: `Invalid collection '${parsedContentItem.system.collection}'`
            });
        }
        return (
            parsedContentItem.system.name !== contentItem.name ||
            parsedContentItem.system.collection !== collection.codename
        );
    }

    private async prepareContentItemAsync(
        managementClient: ManagementClient,
        parsedContentItem: IParsedContentItem,
        importedData: IImportedData
    ): Promise<{ contentItem: ContentItemModels.ContentItem; status: 'created' | 'itemAlreadyExists' }> {
        try {
            const contentItem = await managementClient
                .viewContentItem()
                .byItemCodename(parsedContentItem.system.codename)
                .toPromise()
                .then((m) => m.data);

            logAction('fetch', 'contentItem', {
                title: `Loading item '${contentItem.name}'`,
                codename: contentItem.codename
            });

            importedData.contentItems.push({
                original: parsedContentItem,
                imported: contentItem
            });

            return {
                contentItem: contentItem,
                status: 'itemAlreadyExists'
            };
        } catch (error) {
            if (is404Error(error)) {
                const contentItem = await managementClient
                    .addContentItem()
                    .withData({
                        name: parsedContentItem.system.name,
                        type: {
                            codename: parsedContentItem.system.type
                        },
                        codename: parsedContentItem.system.codename,
                        collection: {
                            codename: parsedContentItem.system.collection
                        }
                    })
                    .toPromise()
                    .then((m) => m.data);

                importedData.contentItems.push({
                    original: parsedContentItem,
                    imported: contentItem
                });

                logAction('create', 'contentItem', {
                    title: `Creating item '${contentItem.name}'`,
                    codename: contentItem.codename
                });

                return {
                    contentItem: contentItem,
                    status: 'created'
                };
            }

            throw error;
        }
    }
}

export const importContentItemHelper = new ImportContentItemHelper();
