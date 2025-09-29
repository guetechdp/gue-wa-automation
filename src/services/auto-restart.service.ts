import * as cron from 'node-cron';
import { Environment } from '../types';

export class AutoRestartService {
    private cronJob: cron.ScheduledTask | null = null;
    private env: Environment;
    private restartCallback: () => Promise<void>;

    constructor(env: Environment, restartCallback: () => Promise<void>) {
        this.env = env;
        this.restartCallback = restartCallback;
    }

    /**
     * Initialize the auto-restart service
     */
    public initialize(): void {
        const cronExpression = this.env.AUTO_RESTART_CRON;
        
        if (!cronExpression) {
            console.log('🔄 Auto-restart not configured (AUTO_RESTART_CRON not set)');
            return;
        }

        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            console.error(`❌ Invalid cron expression: ${cronExpression}`);
            console.error('❌ Expected format: "minute hour day month dayOfWeek" (e.g., "15 15 * * *" for 3:15 PM daily)');
            return;
        }

        console.log(`🔄 Auto-restart configured with cron: ${cronExpression}`);
        
        // Schedule the restart job
        this.cronJob = cron.schedule(cronExpression, async () => {
            console.log('🔄 CRON TRIGGERED: Auto-restart job executed!');
            await this.performRestart();
        }, {
            timezone: 'Asia/Jakarta'
        });

        // Start the cron job
        this.cronJob.start();
        console.log('🔄 CRON JOB STARTED: Auto-restart cron job is now active');
        
        // Log next execution time
        this.logNextExecution();
    }

    /**
     * Perform the restart process
     */
    private async performRestart(): Promise<void> {
        console.log('🔄 Auto-restart triggered by cron schedule');
        console.log('🔄 Initiating graceful shutdown...');
        
        try {
            // Call the restart callback (graceful shutdown)
            await this.restartCallback();
            
            console.log('🔄 Graceful shutdown completed. Process will exit for restart.');
            
            // Give Railway a moment to detect the shutdown
            setTimeout(() => {
                console.log('🔄 Exiting process to trigger Railway restart...');
                
                // Try different restart methods for Railway
                const restartMethod = this.env.AUTO_RESTART_METHOD || 'exit';
                
                if (restartMethod === 'kill') {
                    console.log('🔄 Using process.kill() method...');
                    process.kill(process.pid, 'SIGTERM');
                } else if (restartMethod === 'crash') {
                    console.log('🔄 Using crash method...');
                    throw new Error('Auto-restart triggered - forcing crash');
                } else {
                    console.log('🔄 Using process.exit(1) method...');
                    // Exit with non-zero code to trigger Railway restart
                    process.exit(1);
                }
            }, 1000);
            
        } catch (error) {
            console.error('❌ Error during auto-restart:', error);
            console.log('🔄 Forcing process exit...');
            process.exit(1);
        }
    }

    /**
     * Log the next execution time
     */
    private logNextExecution(): void {
        if (this.cronJob && this.env.AUTO_RESTART_CRON) {
            console.log(`🔄 Auto-restart scheduled with cron: ${this.env.AUTO_RESTART_CRON}`);
        }
    }

    /**
     * Stop the auto-restart service
     */
    public stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob.destroy();
            this.cronJob = null;
            console.log('🔄 Auto-restart service stopped');
        }
    }

    /**
     * Get the current cron expression
     */
    public getCronExpression(): string | undefined {
        return this.env.AUTO_RESTART_CRON;
    }

    /**
     * Check if auto-restart is enabled
     */
    public isEnabled(): boolean {
        return !!this.env.AUTO_RESTART_CRON && !!this.cronJob;
    }

    /**
     * Get next execution time
     */
    public getNextExecution(): Date | null {
        // For now, return null. The cron expression is logged at startup.
        // In a production environment, you might want to use a more advanced
        // cron library to calculate next execution time.
        return null;
    }
}
