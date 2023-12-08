import { IImportContentType, IImportContentTypeElement, IParsedContentItem } from '../import/index.js';
import { IItemFormatService, ItemsTransformData, ItemsParseData, FileBinaryData } from './file-processor.models.js';
import { logErrorAndExit } from '../core/index.js';

export abstract class BaseItemProcessorService implements IItemFormatService {
    abstract name: string;
    abstract transformContentItemsAsync(data: ItemsTransformData): Promise<FileBinaryData>;
    abstract parseContentItemsAsync(data: ItemsParseData): Promise<IParsedContentItem[]>;

    protected getSystemContentItemFields(): string[] {
        return ['type', 'codename', 'name', 'language', 'collection', 'last_modified', 'workflow_step'];
    }

    protected getElement(
        types: IImportContentType[],
        contentItemType: string,
        elementCodename: string
    ): IImportContentTypeElement {
        const type = types.find((m) => m.contentTypeCodename.toLowerCase() === contentItemType.toLowerCase());

        if (!type) {
            logErrorAndExit({
                message: `Could not find content type '${contentItemType}'`
            });
        }

        const element = type.elements.find((m) => m.codename.toLowerCase() === elementCodename.toLowerCase());

        if (!element) {
            logErrorAndExit({
                message: `Could not find element with codename '${elementCodename}' for type '${type.contentTypeCodename}'`
            });
        }

        return element;
    }
}
