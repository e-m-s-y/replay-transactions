import { Container, Contracts, Providers } from "@solar-network/core-kernel";

import { Options } from "./interfaces";
import Service from "./service";

export class ServiceProvider extends Providers.ServiceProvider {
    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    private service = Service.ID;

    public async register(): Promise<void> {
        this.app.bind(this.service).to(Service).inSingletonScope();
        this.logger.info(`[${Service.ID}] Plugin registered, waiting to boot...`);
    }

    public async boot(): Promise<void> {
        this.logger.info(`[${Service.ID}] Booting plugin...`);

        const options = this.config().all() as unknown as Options;

        await this.app.get<Service>(this.service).listen(options);
    }

    public async bootWhen(): Promise<boolean> {
        return !!this.config().get("enabled");
    }

    public async dispose(): Promise<void> {
        this.logger.info(`[${Service.ID}] Plugin disposed`);
    }
}
