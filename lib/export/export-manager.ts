import { ExportContext, ExportConfig, ExportItem } from './export.models.js';
import chalk from 'chalk';
import { AssetModels, CollectionModels, ElementModels } from '@kontent-ai/management-sdk';
import {
    MigrationAsset,
    MigrationItem,
    FlattenedContentTypeElement,
    extractErrorData,
    processSetAsync,
    getBinaryDataFromUrlAsync,
    MigrationElements,
    FlattenedContentType,
    MigrationComponent,
    getDefaultLogger,
    MigrationData,
    isNotUndefined,
    MigrationElementValue,
    getMigrationManagementClient,
    findRequired
} from '../core/index.js';
import { exportTransforms } from '../translation/index.js';
import { exportContextFetcherAsync } from './context/export-context-fetcher.js';

export function exportManager(config: ExportConfig) {
    const logger = config.logger ?? getDefaultLogger();
    const managementClient = getMigrationManagementClient(config);

    const getMigrationItems = (context: ExportContext): readonly MigrationItem[] => {
        return context.exportItems.map<MigrationItem>((exportItem) => mapToMigrationItem(context, exportItem));
    };

    const mapToMigrationItem = (context: ExportContext, exportItem: ExportItem): Readonly<MigrationItem> => {
        const migrationItem: MigrationItem = {
            system: {
                name: exportItem.contentItem.name,
                codename: exportItem.contentItem.codename,
                language: { codename: exportItem.language.codename },
                type: { codename: exportItem.contentType.contentTypeCodename },
                collection: { codename: exportItem.collection.codename },
                workflow: {
                    codename: exportItem.workflow.codename
                }
            },
            versions: exportItem.versions.map((version) => {
                return {
                    elements: getMigrationElements(context, exportItem.contentType, version.languageVariant.elements),
                    workflow_step: {
                        codename: version.workflowStepCodename
                    }
                };
            })
        };

        return migrationItem;
    };

    const mapToMigrationComponent = (
        context: ExportContext,
        component: ElementModels.ContentItemElementComponent
    ): MigrationComponent => {
        const componentType = context.environmentData.contentTypes.find((m) => m.contentTypeId === component.type.id);

        if (!componentType) {
            throw Error(
                `Could not find content type with id '${chalk.red(component.type.id)}' for component '${chalk.red(
                    component.id
                )}'`
            );
        }

        const migrationItem: MigrationComponent = {
            system: {
                id: component.id,
                type: {
                    codename: componentType.contentTypeCodename
                }
            },
            elements: getMigrationElements(context, componentType, component.elements)
        };

        return migrationItem;
    };

    const getMigrationElements = (
        context: ExportContext,
        contentType: FlattenedContentType,
        elements: readonly ElementModels.ContentItemElement[]
    ): MigrationElements => {
        return contentType.elements
            .toSorted((a, b) => {
                if (a.codename < b.codename) {
                    return -1;
                }
                if (a.codename > b.codename) {
                    return 1;
                }
                return 0;
            })
            .reduce<MigrationElements>((model, typeElement) => {
                const itemElement = findRequired(
                    elements,
                    (m) => m.element.id === typeElement.id,
                    `Could not find element '${chalk.red(typeElement.codename)}'`
                );

                model[typeElement.codename] = {
                    type: typeElement.type,
                    value: getValueToStoreFromElement({
                        context: context,
                        contentType: contentType,
                        exportElement: itemElement,
                        typeElement: typeElement
                    })
                };

                return model;
            }, {});
    };

    const getValueToStoreFromElement = (data: {
        context: ExportContext;
        contentType: FlattenedContentType;
        typeElement: FlattenedContentTypeElement;
        exportElement: ElementModels.ContentItemElement;
    }): MigrationElementValue => {
        try {
            return exportTransforms[data.typeElement.type]({
                context: data.context,
                typeElement: data.typeElement,
                exportElement: {
                    components: data.exportElement.components.map((component) =>
                        mapToMigrationComponent(data.context, component)
                    ),
                    value: data.exportElement.value,
                    urlSlugMode: data.exportElement.mode
                }
            });
        } catch (error) {
            const errorData = extractErrorData(error);
            let jsonValue = 'n/a';

            try {
                jsonValue = JSON.stringify(data.exportElement.value);
            } catch (jsonError) {
                console.error(`Failed to convert json value`, jsonError);
            }

            throw new Error(
                `Failed to map value of element '${chalk.yellow(data.typeElement.codename)}' of type '${chalk.cyan(
                    data.typeElement.type
                )}'. Value: ${chalk.bgMagenta(jsonValue)}. Message: ${errorData.message}`
            );
        }
    };

    const exportAssetsAsync = async (context: ExportContext): Promise<readonly MigrationAsset[]> => {
        const assets = Array.from(context.referencedData.assetIds)
            .map<AssetModels.Asset | undefined>((assetId) => context.getAssetStateInSourceEnvironment(assetId).asset)
            .filter(isNotUndefined);

        return await getMigrationAssetsWithBinaryDataAsync(assets, context);
    };

    const getMigrationAssetsWithBinaryDataAsync = async (
        assets: AssetModels.Asset[],
        context: ExportContext
    ): Promise<readonly MigrationAsset[]> => {
        logger.log({
            type: 'info',
            message: `Preparing to download '${chalk.yellow(assets.length.toString())}' assets`
        });

        return await processSetAsync<AssetModels.Asset, MigrationAsset>({
            action: 'Downloading assets',
            logger: logger,
            parallelLimit: 5,
            itemInfo: (input) => {
                return {
                    title: input.codename,
                    itemType: 'asset'
                };
            },
            items: assets,
            processAsync: async (asset, logSpinner) => {
                const assetCollection: CollectionModels.Collection | undefined =
                    context.environmentData.collections.find((m) => m.id === asset.collection?.reference?.id);

                logSpinner({
                    type: 'download',
                    message: `${asset.url}`
                });

                const binaryData = await getBinaryDataFromUrlAsync(asset.url);

                const migrationAsset: MigrationAsset = {
                    filename: asset.fileName,
                    title: asset.title ?? '',
                    codename: asset.codename,
                    binaryData: binaryData.data,
                    collection: assetCollection ? { codename: assetCollection.codename } : undefined,
                    descriptions: asset.descriptions.map((description) => {
                        const language = findRequired(
                            context.environmentData.languages,
                            (language) => language.id === description.language.id,
                            `Could not find language with id '${chalk.red(
                                description.language.id
                            )}' requested by asset '${chalk.red(asset.codename)}'`
                        );

                        return {
                            description: description.description ?? undefined,
                            language: {
                                codename: language.codename
                            }
                        };
                    })
                };

                return migrationAsset;
            }
        });
    };

    return {
        async exportAsync(): Promise<MigrationData> {
            logger.log({
                type: 'info',
                message: `Preparing to export data`
            });

            const exportContext = await (
                await exportContextFetcherAsync({
                    exportItems: config.exportItems,
                    logger: logger,
                    managementClient: managementClient
                })
            ).getExportContextAsync();

            const migrationData: MigrationData = {
                items: getMigrationItems(exportContext),
                assets: await exportAssetsAsync(exportContext)
            };

            logger.log({
                type: 'completed',
                message: `Finished export`
            });

            return migrationData;
        }
    };
}
