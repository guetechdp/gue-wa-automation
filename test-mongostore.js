const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
require('dotenv/config');

async function testMongoStore() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const store = new MongoStore({ mongoose: mongoose });
        
        // Test basic store operations
        console.log('\n🧪 Testing basic store operations:');
        
        const testSessionName = 'test-session';
        
        // Test sessionExists (should be false initially)
        const existsBefore = await store.sessionExists({ session: testSessionName });
        console.log(`  - sessionExists("${testSessionName}"): ${existsBefore}`);
        
        // Test save (create a dummy session)
        console.log(`  - Attempting to save session "${testSessionName}"...`);
        try {
            await store.save({ session: testSessionName, data: 'test-data' });
            console.log('  - Save successful');
        } catch (error) {
            console.log(`  - Save failed: ${error.message}`);
        }
        
        // Test sessionExists again (should be true now)
        const existsAfter = await store.sessionExists({ session: testSessionName });
        console.log(`  - sessionExists("${testSessionName}"): ${existsAfter}`);
        
        // Test delete
        console.log(`  - Attempting to delete session "${testSessionName}"...`);
        try {
            await store.delete({ session: testSessionName });
            console.log('  - Delete successful');
        } catch (error) {
            console.log(`  - Delete failed: ${error.message}`);
        }
        
        // Test sessionExists again (should be false now)
        const existsAfterDelete = await store.sessionExists({ session: testSessionName });
        console.log(`  - sessionExists("${testSessionName}"): ${existsAfterDelete}`);

        // List all collections to see what was created
        console.log('\n📋 All collections in database:');
        const collections = await mongoose.connection.db.listCollections().toArray();
        for (const col of collections) {
            console.log(`  - ${col.name}`);
        }

        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testMongoStore();

