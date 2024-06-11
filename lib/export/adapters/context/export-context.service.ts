import {
    ExportContext,
    ExportContextEnvironmentData,
    KontentAiExportRequestItem,
    KontentAiPreparedExportItem
} from '../../export.models.js';
import {
    AssetStateInSourceEnvironmentById,
    ItemStateInSourceEnvironmentById,
    Logger,
    getFlattenedContentTypesAsync,
    is404Error,
    processInChunksAsync,
    runMapiRequestAsync,
    uniqueStringFilter
} from '../../../core/index.js';
import {
    AssetModels,
    CollectionModels,
    ContentItemModels,
    LanguageModels,
    LanguageVariantModels,
    ManagementClient,
    TaxonomyModels,
    WorkflowModels
} from '@kontent-ai/management-sdk';
import chalk from 'chalk';
import { ItemsExtractionService, getItemsExtractionService } from '../../../translation/index.js';
import { throwErrorForItemRequest } from '../../utils/export.utils.js';

export function getExportContextService(logger: Logger, managementClient: ManagementClient): ExportContextService {
    return new ExportContextService(logger, managementClient);
}

export class ExportContextService {
    private readonly itemsExtractionService: ItemsExtractionService;

    constructor(private readonly logger: Logger, private readonly managementClient: ManagementClient) {
        this.itemsExtractionService = getItemsExtractionService();
    }

    async getExportContextAsync(data: { exportItems: KontentAiExportRequestItem[] }): Promise<ExportContext> {
        const environmentData = await this.getEnvironmentDataAsync();

        this.logger.log({
            type: 'info',
            message: `Preparing '${chalk.yellow(data.exportItems.length.toString())}' items for export`
        });
        const preparedItems = await this.prepareExportItemsAsync({
            environmentData: environmentData,
            exportItems: data.exportItems
        });

        this.logger.log({
            type: 'info',
            message: `Extracting referenced items from content`
        });

        const referencedData = this.itemsExtractionService.extractReferencedDataFromExportItems(preparedItems);

        // fetch both referenced items and items that are set to be exported
        const itemIdsToCheckInTargetEnv: string[] = [
            ...referencedData.itemIds,
            ...preparedItems.map((m) => m.contentItem.id)
        ].filter(uniqueStringFilter);

        const assetIdsToCheckInTargetEnv: string[] = [...referencedData.assetIds];

        this.logger.log({
            type: 'info',
            message: `Fetching referenced items`
        });
        const itemStates: ItemStateInSourceEnvironmentById[] = await this.getItemStatesAsync(
            itemIdsToCheckInTargetEnv
        );

        this.logger.log({
            type: 'info',
            message: `Fetching referenced assets`
        });
        const assetStates: AssetStateInSourceEnvironmentById[] = await this.getAssetStatesAsync(
            assetIdsToCheckInTargetEnv
        );

        return {
            preparedExportItems: preparedItems,
            environmentData: environmentData,
            referencedData: referencedData,
            getAssetStateInSourceEnvironment: (id) => {
                const assetSate = assetStates.find((m) => m.id === id);

                if (!assetSate) {
                    throw Error(`Invalid state for asset '${id}'. It is expected that all asset states will exist`);
                }

                return assetSate;
            },
            getItemStateInSourceEnvironment: (id) => {
                const itemState = itemStates.find((m) => m.id === id);

                if (!itemState) {
                    throw Error(`Invalid state for item '${id}'. It is expected that all item states will exist`);
                }

                return itemState;
            }
        };
    }

    private async prepareExportItemsAsync(data: {
        environmentData: ExportContextEnvironmentData;
        exportItems: KontentAiExportRequestItem[];
    }): Promise<KontentAiPreparedExportItem[]> {
        const items: KontentAiPreparedExportItem[] = await processInChunksAsync<
            KontentAiExportRequestItem,
            KontentAiPreparedExportItem
        >({
            logger: this.logger,
            chunkSize: 1,
            itemInfo: (input) => {
                return {
                    title: `${input.itemCodename} (${input.languageCodename})`,
                    itemType: 'exportedItem'
                };
            },
            items: data.exportItems,
            processAsync: async (exportItem, logSpinner) => {
                const contentItem = await runMapiRequestAsync({
                    logger: this.logger,
                    logSpinner: logSpinner,
                    func: async () =>
                        (
                            await this.managementClient
                                .viewContentItem()
                                .byItemCodename(exportItem.itemCodename)
                                .toPromise()
                        ).data,
                    action: 'view',
                    type: 'contentItem',
                    itemName: `codename -> ${exportItem.itemCodename} (${exportItem.languageCodename})`
                });

                const languageVariant = await runMapiRequestAsync({
                    logger: this.logger,
                    logSpinner: logSpinner,
                    func: async () =>
                        (
                            await this.managementClient
                                .viewLanguageVariant()
                                .byItemCodename(exportItem.itemCodename)
                                .byLanguageCodename(exportItem.languageCodename)
                                .toPromise()
                        ).data,
                    action: 'view',
                    type: 'languageVariant',
                    itemName: `codename -> ${exportItem.itemCodename} (${exportItem.languageCodename})`
                });

                const collection = data.environmentData.collections.find((m) => m.id === contentItem.collection.id);

                if (!collection) {
                    throwErrorForItemRequest(
                        exportItem,
                        `Invalid collection '${chalk.yellow(contentItem.collection.id ?? '')}'`
                    );
                }

                const contentType = data.environmentData.contentTypes.find(
                    (m) => m.contentTypeId === contentItem.type.id
                );

                if (!contentType) {
                    throwErrorForItemRequest(exportItem, `Invalid content type '${chalk.yellow(contentItem.type.id)}'`);
                }

                const language = data.environmentData.languages.find((m) => m.id === languageVariant.language.id);

                if (!language) {
                    throwErrorForItemRequest(
                        exportItem,
                        `Invalid language '${chalk.yellow(languageVariant.language.id ?? '')}'`
                    );
                }

                const workflow = data.environmentData.workflows.find(
                    (m) => m.id === languageVariant.workflow.workflowIdentifier.id
                );

                if (!workflow) {
                    throwErrorForItemRequest(
                        exportItem,
                        `Invalid workflow '${chalk.yellow(languageVariant.workflow.workflowIdentifier.id ?? '')}'`
                    );
                }

                const workflowStepCodename = this.getWorkflowStepCodename(workflow, languageVariant);

                if (!workflowStepCodename) {
                    throwErrorForItemRequest(
                        exportItem,
                        `Invalid workflow step '${chalk.yellow(languageVariant.workflow.stepIdentifier.id ?? '')}'`
                    );
                }

                const preparedItem: KontentAiPreparedExportItem = {
                    contentItem: contentItem,
                    languageVariant: languageVariant,
                    contentType: contentType,
                    requestItem: exportItem,
                    workflow: workflow,
                    workflowStepCodename: workflowStepCodename,
                    collection: collection,
                    language: language
                };

                return preparedItem;
            }
        });

        return items;
    }

    private getWorkflowStepCodename(
        workflow: WorkflowModels.Workflow,
        languageVariant: LanguageVariantModels.ContentItemLanguageVariant
    ): string | undefined {
        const variantStepId = languageVariant.workflow.stepIdentifier.id;

        for (const step of workflow.steps) {
            if (step.id === variantStepId) {
                return step.codename;
            }
        }

        if (workflow.archivedStep.id === variantStepId) {
            return workflow.archivedStep.codename;
        }

        if (workflow.scheduledStep.id === variantStepId) {
            return workflow.scheduledStep.codename;
        }

        if (workflow.publishedStep.id === variantStepId) {
            return workflow.publishedStep.codename;
        }

        return undefined;
    }

    private async getEnvironmentDataAsync(): Promise<ExportContextEnvironmentData> {
        const environmentData: ExportContextEnvironmentData = {
            collections: await this.getAllCollectionsAsync(),
            contentTypes: await getFlattenedContentTypesAsync(this.managementClient, this.logger),
            languages: await this.getAllLanguagesAsync(),
            workflows: await this.getAllWorkflowsAsync(),
            taxonomies: await this.getAllTaxonomiesAsync()
        };

        return environmentData;
    }

    private async getAllLanguagesAsync(): Promise<LanguageModels.LanguageModel[]> {
        return await runMapiRequestAsync({
            logger: this.logger,
            func: async () => (await this.managementClient.listLanguages().toAllPromise()).data.items,
            action: 'list',
            type: 'language'
        });
    }

    private async getAllCollectionsAsync(): Promise<CollectionModels.Collection[]> {
        return await runMapiRequestAsync({
            logger: this.logger,
            func: async () => (await this.managementClient.listCollections().toPromise()).data.collections,
            action: 'list',
            type: 'collection'
        });
    }

    private async getAllWorkflowsAsync(): Promise<WorkflowModels.Workflow[]> {
        return await runMapiRequestAsync({
            logger: this.logger,
            func: async () => (await this.managementClient.listWorkflows().toPromise()).data,
            action: 'list',
            type: 'workflow'
        });
    }

    private async getAllTaxonomiesAsync(): Promise<TaxonomyModels.Taxonomy[]> {
        return await runMapiRequestAsync({
            logger: this.logger,
            func: async () => (await this.managementClient.listTaxonomies().toAllPromise()).data.items,
            action: 'list',
            type: 'taxonomy'
        });
    }

    private async getContentItemsByIdsAsync(itemIds: string[]): Promise<ContentItemModels.ContentItem[]> {
        const contentItems: ContentItemModels.ContentItem[] = [];

        await processInChunksAsync<string, void>({
            logger: this.logger,
            chunkSize: 1,
            items: itemIds,
            itemInfo: (id) => {
                return {
                    itemType: 'contentItem',
                    title: id
                };
            },
            processAsync: async (id, logSpinner) => {
                try {
                    const contentItem = await runMapiRequestAsync({
                        logSpinner: logSpinner,
                        logger: this.logger,
                        func: async () => (await this.managementClient.viewContentItem().byItemId(id).toPromise()).data,
                        action: 'view',
                        type: 'contentItem',
                        itemName: `id -> ${id}`
                    });

                    contentItems.push(contentItem);
                } catch (error) {
                    if (!is404Error(error)) {
                        throw error;
                    }
                }
            }
        });

        return contentItems;
    }

    private async getAssetsByIdsAsync(itemIds: string[]): Promise<AssetModels.Asset[]> {
        const assets: AssetModels.Asset[] = [];

        await processInChunksAsync<string, void>({
            logger: this.logger,
            chunkSize: 1,
            items: itemIds,
            itemInfo: (id) => {
                return {
                    itemType: 'asset',
                    title: id
                };
            },
            processAsync: async (id, logSpinner) => {
                try {
                    const asset = await runMapiRequestAsync({
                        logger: this.logger,
                        logSpinner: logSpinner,
                        func: async () => (await this.managementClient.viewAsset().byAssetId(id).toPromise()).data,
                        action: 'view',
                        type: 'asset',
                        itemName: `id -> ${id}`
                    });

                    assets.push(asset);
                } catch (error) {
                    if (!is404Error(error)) {
                        throw error;
                    }
                }
            }
        });

        return assets;
    }

    private async getItemStatesAsync(itemIds: string[]): Promise<ItemStateInSourceEnvironmentById[]> {
        const items = await this.getContentItemsByIdsAsync(itemIds);
        const itemStates: ItemStateInSourceEnvironmentById[] = [];

        for (const itemId of itemIds) {
            const item = items.find((m) => m.id === itemId);

            if (item) {
                itemStates.push({
                    id: itemId,
                    item: item,
                    state: 'exists'
                });
            } else {
                itemStates.push({
                    id: itemId,
                    item: undefined,
                    state: 'doesNotExists'
                });
            }
        }

        return itemStates;
    }

    private async getAssetStatesAsync(assetIds: string[]): Promise<AssetStateInSourceEnvironmentById[]> {
        const assets = await this.getAssetsByIdsAsync(assetIds);
        const assetStates: AssetStateInSourceEnvironmentById[] = [];

        for (const assetId of assetIds) {
            const asset = assets.find((m) => m.id === assetId);

            if (asset) {
                assetStates.push({
                    id: assetId,
                    asset: asset,
                    state: 'exists'
                });
            } else {
                assetStates.push({
                    id: assetId,
                    asset: undefined,
                    state: 'doesNotExists'
                });
            }
        }

        return assetStates;
    }
}
