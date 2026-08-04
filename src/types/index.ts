/**
 * @author Merite15
 * @created 2025-04-26 07:17:12
 */

/**
 * Represents information about a Nuxt component
 */
export interface NuxtComponentInfo {
    name: string;
    path: string;
    isAutoImported: boolean;
    exportType?: string
    members?: {
        state?: string[];
        getters?: string[];
        actions?: string[];
        methods?: string[];
        variables?: string[];
    };
}

export interface ComponentPropInfo {
    name: string;
    type: string;
    required: boolean;
}

export interface ComponentSlotInfo {
    name: string;
}

export interface ComponentMetadata {
    props: ComponentPropInfo[];
    slots: ComponentSlotInfo[];
}