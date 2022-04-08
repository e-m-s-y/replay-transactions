export interface Batch {
    senderIdChild: string;
    mnemonicParent: string;
}

export interface Query {
    senderId?: string;
    recipientId?: string;
    vendorField?: string;
}

export interface Options {
    enabled: boolean;
    url: string;
    query: Query;
    pageLimit: number | 100;
    coreVersionChild: 2 | 3;
    batches: Batch[];
}
