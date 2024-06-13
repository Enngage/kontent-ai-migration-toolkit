export type MigrationElementType =
    | 'text'
    | 'rich_text'
    | 'number'
    | 'multiple_choice'
    | 'date_time'
    | 'asset'
    | 'modular_content'
    | 'taxonomy'
    | 'url_slug'
    | 'custom'
    | 'subpages';

export type MigrationElementValue = string | undefined | MigrationReference[] | number;

export interface MigrationElement<
    TElementType extends MigrationElementType = MigrationElementType,
    TValue extends MigrationElementValue = MigrationElementValue
> {
    /**
     * Value of the element
     */
    readonly value: TValue;

    /**
     * Type of the element
     */
    readonly type: TElementType;
}

export namespace MigrationElementModels {
    export interface TextElement extends MigrationElement<'text', string | undefined> {}
    export interface NumberElement extends MigrationElement<'number', number | undefined> {}
    export interface RichTextElement extends MigrationElement<'rich_text', string | undefined> {}
    export interface MultipleChoiceElement
        extends MigrationElement<'multiple_choice', MigrationReference[] | undefined> {}
    export interface DateTimeElement extends MigrationElement<'date_time', string | undefined> {}
    export interface AssetElement extends MigrationElement<'asset', MigrationReference[] | undefined> {}
    export interface LinkedItemsElement extends MigrationElement<'modular_content', MigrationReference[] | undefined> {}
    export interface TaxonomyElement extends MigrationElement<'taxonomy', MigrationReference[] | undefined> {}
    export interface UrlSlugElement extends MigrationElement<'url_slug', string | undefined> {}
    export interface CustomElement extends MigrationElement<'custom', string | undefined> {}
    export interface SubpagesElement extends MigrationElement<'subpages', MigrationReference[] | undefined> {}
}

export interface MigrationElements {
    [elementCodename: string]: MigrationElement;
}

export interface MigrationItem<TElements extends MigrationElements = MigrationElements> {
    readonly system: {
        /**
         * Codename of the content item
         */
        readonly codename: string;
        /**
         * Name of the content item
         */
        readonly name: string;
        /**
         * Language of the language variant
         */
        readonly language: MigrationReference;
        /**
         * Content type of the item
         */
        readonly type: MigrationReference;
        /**
         * Collection of the item
         */
        readonly collection: MigrationReference;

        /**
         * Undefined only if migration item represents components in RTE
         */
        readonly workflow?: MigrationReference;
        /**
         * Undefined only if migration item represents components in RTE
         */
        readonly workflow_step?: MigrationReference;
    };
    readonly elements: TElements;
}

export interface MigrationReference {
    /**
     * Codename of the referenced object
     */
    readonly codename: string;
}

export interface MigrationAssetDescription {
    readonly language: MigrationReference;
    readonly description: string | undefined;
}

export interface MigrationAsset {
    /**
     * Name of the file used in zip package. Only used for purposes of this library.
     */
    readonly _zipFilename: string;
    /**
     * Codename of the asset
     */
    readonly codename: string;
    /**
     * Binary data of the asset
     */
    readonly binaryData: Buffer | Blob | undefined;
    /**
     * Filename of the asset, will be used as a filename in Kontent.ai after importing the asset
     */
    readonly filename: string;
    /**
     * Title of the asset
     */
    readonly title: string;

    /**
     * Optional
     * Collection of the asset
     */
    readonly collection?: MigrationReference;

    /**
     * Optional.
     * Descriptions of the assets
     */
    readonly descriptions?: MigrationAssetDescription[];
}
