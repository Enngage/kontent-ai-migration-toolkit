import { AssetModels, CollectionModels, LanguageModels } from '@kontent-ai/management-sdk';
import { MigrationAsset, MigrationAssetDescription, findRequired, geSizeInBytes } from '../../core/index.js';
import deepEqual from 'deep-equal';

export function shouldUpdateAsset(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
    readonly collections: readonly CollectionModels.Collection[];
    readonly languages: readonly LanguageModels.LanguageModel[];
}): boolean {
    if (!isInSameCollection(data)) {
        return true;
    }

    if (!areDescriptionsIdentical(data)) {
        return true;
    }

    if (!isTitleIdentical(data)) {
        return true;
    }

    if (!isBinaryFileIdentical(data)) {
        return true;
    }

    return false;
}

export function shouldReplaceBinaryFile(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
}): boolean {
    if (!isBinaryFileIdentical(data)) {
        return true;
    }

    return false;
}

function isBinaryFileIdentical(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
}): boolean {
    const sourceFileSize = geSizeInBytes(data.migrationAsset.binaryData);
    const targetFileSize = data.targetAsset.size;

    const sourceFilename = data.migrationAsset.filename;
    const targetFilename = data.targetAsset.fileName;

    return sourceFileSize === targetFileSize && sourceFilename === targetFilename;
}

function isTitleIdentical(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
}): boolean {
    const sourceTitle = data.migrationAsset.title?.length ? data.migrationAsset.title : undefined;
    const targetTitle = data.targetAsset.title?.length ? data.targetAsset.title : undefined;

    return sourceTitle === targetTitle;
}

function isInSameCollection(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
    readonly collections: readonly CollectionModels.Collection[];
}): boolean {
    return (
        data.collections.find((m) => m.id === data.targetAsset.collection?.reference?.id)?.codename ===
        data.migrationAsset.collection?.codename
    );
}

function areDescriptionsIdentical(data: {
    readonly migrationAsset: MigrationAsset;
    readonly targetAsset: Readonly<AssetModels.Asset>;
    readonly languages: readonly LanguageModels.LanguageModel[];
}): boolean {
    const sourceMigrationDescriptions = (data.migrationAsset.descriptions ?? [])
        .map<MigrationAssetDescription>((description) => {
            return {
                description: description.description?.length ? description.description : undefined,
                language: {
                    codename: description.language.codename
                }
            };
        })
        .toSorted();
    const targetMigrationDescriptions = mapToMigrationDescriptions(data).toSorted();

    return deepEqual(sourceMigrationDescriptions, targetMigrationDescriptions);
}

function mapToMigrationDescriptions(data: {
    readonly targetAsset: Readonly<AssetModels.Asset>;
    readonly languages: readonly LanguageModels.LanguageModel[];
}): MigrationAssetDescription[] {
    return data.targetAsset.descriptions.map((description) => {
        const languageId = description.language.id;

        return {
            description: description.description?.length ? description.description : undefined,
            language: {
                codename: findRequired(
                    data.languages,
                    (language) => language.id === languageId,
                    `Could not find language with id '${languageId}'`
                ).codename
            }
        };
    });
}
