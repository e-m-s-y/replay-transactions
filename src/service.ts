import { Builders, Enums } from "@foly/helios-crypto";
import { Container, Contracts, Providers, Utils } from "@solar-network/core-kernel";
import { Identities, Interfaces } from "@solar-network/crypto";
import axios from "axios";
import { AxiosRequestConfig } from "axios";

import { Batch, Options } from "./interfaces";

@Container.injectable()
export default class Service {
    public static readonly ID = "@foly/replay-game-transactions";

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.TransactionPoolProcessor)
    private readonly processor!: Contracts.TransactionPool.Processor;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@solar-network/core-transaction-pool")
    private readonly transactionPoolConfiguration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.WalletRepository)
    @Container.tagged("state", "blockchain")
    private readonly walletRepository!: Contracts.State.WalletRepository;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly emitter!: Contracts.Kernel.EventDispatcher;

    public async listen(options: Options): Promise<void> {
        if (options.batches.length === 0) {
            return this.logger.info(`[${Service.ID}] Batches are empty.`);
        }

        this.logger.info(`[${Service.ID}] Preparing ${options.batches.length} batches...`);

        let batches: Array<any> = [];
        let currentBatchIndex = 0;
        let currentChunkIndex = 0;
        let totalTransactionsCount = 0;
        let acceptedTransactionsCount = 0;
        let rejectedTransactionsCount = 0;
        const chunkProcessorHandler = {
            handle: async (payload: any) => {
                const chunks: Array<any> = batches[currentBatchIndex] ?? [];

                if (currentChunkIndex in chunks) {
                    const result = await this.processor.process(chunks[currentChunkIndex]);

                    this.logger.info(
                        `[${Service.ID}] Processed chunk ${currentChunkIndex + 1}/${chunks.length} in batch ${
                            currentBatchIndex + 1
                        }/${batches.length}`,
                    );

                    totalTransactionsCount += chunks[currentChunkIndex].length;
                    acceptedTransactionsCount += result.accept.length;
                    rejectedTransactionsCount += result.invalid.length;

                    if (rejectedTransactionsCount > 0) {
                        this.logger.info(
                            `[${Service.ID}] Could not process chunk, the processor rejected transactions`,
                        );
                        this.logger.info(`[${Service.ID}] Aborting...`);
                        this.emitter.forget("block.applied", chunkProcessorHandler);

                        return;
                    }

                    if (!(++currentChunkIndex in chunks)) {
                        currentChunkIndex = 0;
                        ++currentBatchIndex;
                    }
                }

                if (!(currentBatchIndex in batches)) {
                    this.logger.info(
                        `[${Service.ID}] Processed all chunks with a total of ${totalTransactionsCount} transactions`,
                    );
                    this.logger.info(`[${Service.ID}] Processor accepted ${acceptedTransactionsCount} transactions`);
                    this.logger.info(`[${Service.ID}] Processor rejected ${rejectedTransactionsCount} transactions`);
                    this.emitter.forget("block.applied", chunkProcessorHandler);
                }
            },
        };

        const createBatchesHandler = {
            handle: async (payload: any) => {
                batches = await this.createBatches(options);

                this.emitter.forget("block.applied", createBatchesHandler);
                this.emitter.listen("block.applied", chunkProcessorHandler);
                this.logger.info(
                    `[${Service.ID}] Batches are ready, waiting for the next block to be forged to start processing transactions...`,
                );
            },
        };
        this.emitter.listen("block.applied", createBatchesHandler);
        this.logger.info(`[${Service.ID}] Waiting for the next block to be forged...`);
    }

    private async createBatches(options: Options): Promise<Array<any>> {
        const batches: Array<any> = [];

        for (const batch of options.batches) {
            batches.push(await this.createChunks(batch, options));
        }

        return batches;
    }

    private async getTransactions(
        batch: Batch,
        options: Options,
        page: number = 1,
        data: Map<string, Interfaces.ITransactionData> = new Map(),
    ): Promise<any> {
        const config = this.createRequestConfig(batch, options, page);

        return await axios.request(config).then(async (response) => {
            if (response && response.data && response.data.data && response.data.data.length) {
                for (const transaction of response.data.data) {
                    data.set(transaction.recipient, transaction);
                }

                if (response.data.meta && response.data.meta.pageCount > page) {
                    return await this.getTransactions(batch, options, page + 1, data);
                }
            }

            return data;
        });
    }

    private createRequestConfig(batch: Batch, options: Options, page: number): AxiosRequestConfig {
        if (options.coreVersionChild === 3) {
            const query = Utils.merge(
                {
                    senderId: batch.senderIdChild,
                    page,
                    limit: options.pageLimit,
                    type: Enums.TransactionType.CharacterRegistration,
                    typeGroup: Enums.TransactionTypeGroup.Helios,
                },
                options.query,
            );

            return {
                url: options.url,
                method: "GET",
                params: query,
            };
        }

        const data = Utils.merge(
            {
                senderId: batch.senderIdChild,
                type: Enums.TransactionType.CharacterRegistration,
                typeGroup: Enums.TransactionTypeGroup.Helios,
            },
            options.query,
        );

        return {
            url: options.url,
            method: "POST",
            params: {
                page,
                limit: options.pageLimit,
            },
            data,
        };
    }

    private async createChunks(batch: Batch, options: Options): Promise<Array<any>> {
        const transactions = await this.getTransactions(batch, options);

        this.logger.info(`[${Service.ID}] Found ${transactions.size} transactions`);

        const replayTransactions: Array<Interfaces.ITransactionData> = await this.createReplayTransactions(
            transactions,
            batch,
        );

        this.logger.info(`[${Service.ID}] Created ${replayTransactions.length} replay transactions`);

        const maxTransactionsPerChunk: number =
            this.transactionPoolConfiguration.getRequired<number>("maxTransactionsPerRequest");

        const chunks: Array<any> = this.chunkify([...replayTransactions], maxTransactionsPerChunk);

        this.logger.info(
            `[${Service.ID}] Created ${chunks.length} chunks with max ${maxTransactionsPerChunk} transactions per chunk for ${batch.senderIdChild}`,
        );

        return chunks;
    }

    private async createReplayTransactions(
        transactions: Map<string, Interfaces.ITransactionData> = new Map(),
        batch: Batch,
    ): Promise<Array<Interfaces.ITransactionData>> {
        let nonce: Utils.BigNumber = this.walletRepository.getNonce(
            Identities.PublicKey.fromPassphrase(batch.mnemonicParent),
        );
        const replayTransactions: Array<Interfaces.ITransactionData> = [];

        transactions.forEach((data, recipient) => {
            if (data.asset && data.asset.character) {
                const loginTransaction = Builders.BuilderFactory.authentication()
                    .version(2)
                    .recipientId(recipient)
                    .nonce((nonce = nonce.plus(1)).toString())
                    .setLoggedIn(true)
                    .sign(batch.mnemonicParent);

                replayTransactions.push(loginTransaction.getStruct());

                const characterRegistrationTransaction = Builders.BuilderFactory.characterRegistration()
                    .version(2)
                    .recipientId(recipient)
                    .nonce((nonce = nonce.plus(1)).toString())
                    .name(data.asset.character.name)
                    .classId(data.asset.character.classId)
                    .sign(batch.mnemonicParent);

                replayTransactions.push(characterRegistrationTransaction.getStruct());

                const logoutTransaction = Builders.BuilderFactory.authentication()
                    .version(2)
                    .recipientId(recipient)
                    .nonce((nonce = nonce.plus(1)).toString())
                    .setLoggedIn(false)
                    .sign(batch.mnemonicParent);

                replayTransactions.push(logoutTransaction.getStruct());
            }
        });

        return replayTransactions;
    }

    private chunkify(array: Array<any>, size: number): Array<any> {
        const chunks: Array<any> = [];

        for (let i = 0; i < array.length; i += size) {
            const chunk = array.slice(i, i + size);

            chunks.push(chunk);
        }

        return chunks;
    }
}
