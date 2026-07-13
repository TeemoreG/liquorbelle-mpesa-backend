const { MongoClient } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
    this.connectionOptions = {
      tls: true,
      tlsAllowInvalidCertificates: false,
      family: 4,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      retryReads: true,
    };
  }

  /**
   * Connect to MongoDB with retry logic
   */
  async connect() {
    const MONGODB_URI = process.env.MONGODB_URI;
    
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI environment variable is not set');
      process.exit(1);
    }

    try {
      console.log('🔄 Connecting to MongoDB...');
      
      this.client = new MongoClient(MONGODB_URI, this.connectionOptions);
      await this.client.connect();
      
      this.db = this.client.db('liquorbelle');
      this.isConnected = true;
      this.retryCount = 0;
      
      console.log('✅ MongoDB connected successfully');
      console.log(`   📊 Database: ${this.db.databaseName}`);
      console.log(`   🔌 Connection pool: ${this.connectionOptions.minPoolSize} - ${this.connectionOptions.maxPoolSize}`);
      
      // Create indexes
      await this.createIndexes();
      
      // Start health check
      this.startHealthCheck();
      
      return this.db;
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      this.isConnected = false;
      
      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = this.retryDelay * this.retryCount;
        console.log(`🔄 Retry ${this.retryCount}/${this.maxRetries} in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.connect();
      } else {
        console.error('❌ Max retries reached. Exiting...');
        process.exit(1);
      }
    }
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes() {
    try {
      console.log('📇 Creating database indexes...');
      
      // Products collection
      await this.db.collection('products').createIndex({ name: 1 });
      await this.db.collection('products').createIndex({ category: 1 });
      await this.db.collection('products').createIndex({ createdAt: -1 });
      await this.db.collection('products').createIndex({ isTrending: 1 });
      await this.db.collection('products').createIndex({ isNew: 1 });
      
      // Orders collection
      await this.db.collection('orders').createIndex({ order_number: 1 }, { unique: true });
      await this.db.collection('orders').createIndex({ customer_email: 1 });
      await this.db.collection('orders').createIndex({ created_at: -1 });
      await this.db.collection('orders').createIndex({ status: 1 });
      await this.db.collection('orders').createIndex({ payment_method: 1 });
      await this.db.collection('orders').createIndex({ created_at: -1, status: 1 });
      
      // Customers collection
      await this.db.collection('customers').createIndex({ email: 1 }, { unique: true });
      await this.db.collection('customers').createIndex({ phone: 1 });
      await this.db.collection('customers').createIndex({ created_at: -1 });
      
      // Settings collections
      await this.db.collection('settings').createIndex({ key: 1 }, { unique: true });
      await this.db.collection('admin_settings').createIndex({ key: 1 }, { unique: true });
      
      // TTL indexes for temporary data
      await this.db.collection('pending_orders').createIndex(
        { created_at: 1 }, 
        { expireAfterSeconds: 3600 }
      );
      
      await this.db.collection('otps').createIndex(
        { created_at: 1 }, 
        { expireAfterSeconds: 600 }
      );
      
      // Delivery zones
      await this.db.collection('delivery_zones').createIndex({ name: 1 });
      await this.db.collection('delivery_zones').createIndex({ active: 1 });
      
      console.log('✅ All indexes created successfully');
      
    } catch (error) {
      console.error('⚠️ Index creation warning:', error.message);
    }
  }

  /**
   * Start periodic health check
   */
  startHealthCheck() {
    setInterval(async () => {
      try {
        if (this.isConnected) {
          await this.db.command({ ping: 1 });
        }
      } catch (error) {
        console.warn('⚠️ MongoDB health check failed:', error.message);
        this.isConnected = false;
        // Attempt reconnect
        this.reconnect();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Reconnect if connection lost
   */
  async reconnect() {
    if (!this.isConnected) {
      console.log('🔄 Attempting to reconnect to MongoDB...');
      try {
        await this.connect();
      } catch (error) {
        console.error('❌ Reconnection failed:', error.message);
      }
    }
  }

  /**
   * Get database instance
   */
  getDB() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Get MongoDB client
   */
  getClient() {
    return this.client;
  }

  /**
   * Check connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      database: this.db?.databaseName || 'N/A',
      poolSize: this.client?.options?.maxPoolSize || 'N/A',
      retryCount: this.retryCount,
    };
  }

  /**
   * Execute transaction with retry
   */
  async withTransaction(callback) {
    const session = this.client.startSession();
    let result;
    
    try {
      await session.withTransaction(async () => {
        result = await callback(session);
      });
      return result;
    } catch (error) {
      console.error('Transaction failed:', error.message);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Bulk operation helper with error handling
   */
  async bulkOperation(collection, operations) {
    const db = this.getDB();
    const bulk = db.collection(collection).initializeUnorderedBulkOp();
    
    operations.forEach(op => {
      if (op.type === 'insert') bulk.insert(op.document);
      if (op.type === 'update') bulk.find(op.filter).update(op.update);
      if (op.type === 'delete') bulk.find(op.filter).delete();
    });
    
    try {
      return await bulk.execute();
    } catch (error) {
      console.error('Bulk operation failed:', error.message);
      throw error;
    }
  }

  /**
   * Close database connection gracefully
   */
  async close() {
    if (this.client) {
      console.log('🔄 Closing MongoDB connection...');
      await this.client.close();
      this.isConnected = false;
      this.db = null;
      console.log('✅ MongoDB connection closed');
    }
  }

  /**
   * Get collection with validation
   */
  collection(name) {
    const db = this.getDB();
    return db.collection(name);
  }

  /**
   * Check if collection exists
   */
  async collectionExists(name) {
    const db = this.getDB();
    const collections = await db.listCollections({ name }).toArray();
    return collections.length > 0;
  }

  /**
   * Get collection stats
   */
  async getCollectionStats(name) {
    try {
      const db = this.getDB();
      const stats = await db.collection(name).stats();
      return {
        name: stats.ns,
        count: stats.count,
        size: stats.size,
        avgObjSize: stats.avgObjSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
      };
    } catch (error) {
      console.warn(`⚠️ Cannot get stats for ${name}:`, error.message);
      return null;
    }
  }

  /**
   * Run aggregation pipeline with caching option
   */
  async aggregate(collection, pipeline, options = {}) {
    const db = this.getDB();
    const cursor = db.collection(collection).aggregate(pipeline, options);
    return await cursor.toArray();
  }

  /**
   * Find with pagination
   */
  async findPaginated(collection, filter = {}, options = {}) {
    const db = this.getDB();
    const {
      page = 1,
      limit = 20,
      sort = { created_at: -1 },
      projection = {}
    } = options;
    
    const skip = (page - 1) * limit;
    
    const [items, total] = await Promise.all([
      db.collection(collection)
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection(collection).countDocuments(filter)
    ]);
    
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    };
  }
}

// Export singleton instance
const dbInstance = new Database();

module.exports = {
  connectDB: () => dbInstance.connect(),
  getDB: () => dbInstance.getDB(),
  getClient: () => dbInstance.getClient(),
  closeDB: () => dbInstance.close(),
  db: dbInstance,
  Database
};