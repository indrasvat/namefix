import { describe, it } from 'vitest';
import { NamefixService } from './NamefixService.js';
import { IProfile, IConfig, IConfigStore } from '../types/index.js';

class MockConfigStore implements IConfigStore {
    private config: IConfig;
    constructor(config: IConfig) {
        this.config = config;
    }
    async get() { return this.config; }
    async set(next: Partial<IConfig>) {
        this.config = { ...this.config, ...next };
        return this.config;
    }
    onChange(cb: (config: IConfig) => void) { return () => {}; }
}

describe('ReorderProfiles Benchmark', () => {
    it('measures performance of reorderProfiles', async () => {
        const numProfiles = 1000;
        const profiles: IProfile[] = [];
        for (let i = 0; i < numProfiles; i++) {
            profiles.push({
                id: `profile-${i}`,
                name: `Profile ${i}`,
                enabled: true,
                pattern: '*',
                template: '',
                prefix: '',
                priority: i,
            });
        }

        const configStore = new MockConfigStore({
            watchDir: '',
            watchDirs: [],
            prefix: '',
            include: [],
            exclude: [],
            dryRun: false,
            theme: '',
            launchOnLogin: false,
            profiles: profiles,
        });

        const service = new NamefixService({ configStore });
        await service.init();

        const orderedIds = [...profiles].reverse().map(p => p.id);

        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            await service.reorderProfiles(orderedIds);
        }
        const end = performance.now();
        console.log(`reorderProfiles took ${end - start}ms for 100 iterations with ${numProfiles} profiles`);
    });
});
