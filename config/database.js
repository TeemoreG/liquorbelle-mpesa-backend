const { MongoClient } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
    this.reconnectTimer = null;
    this.healthCheckTimer = null;
    this.isShuttingDown = false;
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
      console.error('MONGODB_URI environment variable is not set');
      process.exit(1);
    }

    // Don't attempt reconnect if shutting down
    if (this.isShuttingDown) {
      console.log('Skipping connect - server is shutting down');
      return null;
    }

    try {
      console.log('Connecting to MongoDB...');

      this.client = new MongoClient(MONGODB_URI, this.connectionOptions);
      await this.client.connect();

      this.db = this.client.db('liquorbelle');
      this.isConnected = true;
      this.retryCount = 0;

      console.log('MongoDB connected successfully');
      console.log(`   Database: ${this.db.databaseName}`);
      console.log(`   Connection pool: ${this.connectionOptions.minPoolSize} - ${this.connectionOptions.maxPoolSize}`);

      // Create indexes
      await this.createIndexes();

      // Start health check
      this.startHealthCheck();

      return this.db;

    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      this.isConnected = false;

      // Retry logic
      if (this.retryCount < this.maxRetries && !this.isShuttingDown) {
        this.retryCount++;
        const delay = this.retryDelay * this.retryCount;
        console.log(`Retry ${this.retryCount}/${this.maxRetries} in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.connect();
      } else if (this.isShuttingDown) {
        console.log('Connection attempt cancelled - server shutting down');
        return null;
      } else {
        console.error('Max retries reached. Exiting...');
        process.exit(1);
      }
    }
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes() {
    try {
      console.log('Creating database indexes...');

      const collections = await this.db.listCollections().toArray();
      const existingCollections = collections.map(c => c.name);

      // Products collection
      if (existingCollections.includes('products')) {
        try {
          await this.db.collection('products').createIndex({ name: 1 });
          await this.db.collection('products').createIndex({ category: 1 });
          await this.db.collection('products').createIndex({ created_at: -1 });
          await this.db.collection('products').createIndex({ isTrending: 1 });
          await this.db.collection('products').createIndex({ isNew: 1 });
        } catch (err) {
          // Index already exists - ignore
        }
      }

      // Orders collection
      if (existingCollections.includes('orders')) {
        try {
          await this.db.collection('orders').createIndex({ order_number: 1 }, { unique: true });
          await this.db.collection('orders').createIndex({ customer_email: 1 });
          await this.db.collection('orders').createIndex({ created_at: -1 });
          await this.db.collection('orders').createIndex({ status: 1 });
          await this.db.collection('orders').createIndex({ payment_method: 1 });
          await this.db.collection('orders').createIndex({ created_at: -1, status: 1 });
        } catch (err) {
          // Index already exists - ignore
        }
      }

      // Customers collection
      if (existingCollections.includes('customers')) {
        try {
          await this.db.collection('customers').createIndex({ email: 1 }, { unique: true });
          await this.db.collection('customers').createIndex({ phone: 1 });
          await this.db.collection('customers').createIndex({ created_at: -1 });
        } catch (err) {
          // Index already exists - ignore
        }
      }

      // Settings collections
      if (existingCollections.includes('settings')) {
        try {
          await this.db.collection('settings').createIndex({ key: 1 }, { unique: true });
        } catch (err) {
          // Index already exists - ignore
        }
      }

      if (existingCollections.includes('admin_settings')) {
        try {
          await this.db.collection('admin_settings').createIndex({ key: 1 }, { unique: true });
        } catch (err) {
          // Index already exists - ignore
        }
      }

      // TTL indexes for temporary data
      try {
        await this.db.collection('pending_orders').createIndex(
          { created_at: 1 },
          { expireAfterSeconds: 3600 }
        );
      } catch (err) {
        // Index may already exist
      }

      try {
        await this.db.collection('otps').createIndex(
          { created_at: 1 },
          { expireAfterSeconds: 600 }
        );
      } catch (err) {
        // Index may already exist
      }

      // Delivery zones
      try {
        await this.db.collection('delivery_zones').createIndex({ name: 1 });
        await this.db.collection('delivery_zones').createIndex({ active: 1 });
      } catch (err) {
        // Index may already exist
      }

      console.log('All indexes created successfully');

    } catch (error) {
      console.error('Index creation warning:', error.message);
    }
    
    // ✅ AUTO-SEED DELIVERY ZONES (Added to fix deleted delivery-zones.js)
    try {
      const zonesCollection = this.db.collection('delivery_zones');
      const count = await zonesCollection.countDocuments();
      if (count === 0) {
        console.log('🌱 Seeding default delivery zones...');
        await zonesCollection.insertMany([
          { name: 'Dagoretti Road', fee: 150 },
          { name: 'Naivasha Road', fee: 150 },
          { name: 'Kikuyu Road', fee: 150 },
          { name: 'Ngong Road', fee: 150 },
          { name: 'Kilimani', fee: 150 },
          { name: 'Kileleshwa', fee: 150 },
          { name: 'Lavington', fee: 150 },
          { name: 'Hurlingham', fee: 150 },
          { name: 'Upper Hill', fee: 150 },
          { name: 'Nairobi CBD', fee: 150 },
          { name: 'Westlands', fee: 180 },
          { name: 'Parklands', fee: 180 },
          { name: 'Muthaiga', fee: 180 },
          { name: 'Karen', fee: 180 },
          { name: 'Langata', fee: 180 },
          { name: 'Waiyaki Way', fee: 180 },
          { name: 'Rongai', fee: 220 },
          { name: 'South B', fee: 220 },
          { name: 'Waithaka', fee: 220 },
          { name: 'Runda', fee: 220 },
          { name: 'Gigiri', fee: 220 },
          { name: 'Loresho', fee: 220 },
          { name: 'Kiambu Road', fee: 220 },
          { name: 'Ruaka', fee: 280 },
          { name: 'Kikuyu', fee: 280 }
        ]);
        console.log('✅ Default delivery zones seeded successfully');
      } else {
        console.log(`✅ Found ${count} delivery zones in database. Skipping seed.`);
      }
    } catch (err) {
      console.warn('⚠️ Could not seed delivery zones:', err.message);
    }
  }

  /**
   * Start periodic health check
   */
  startHealthCheck() {
    // Clear any existing timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        if (this.isConnected && this.db && !this.isShuttingDown) {
          await this.db.command({ ping: 1 });
        }
      } catch (error) {
        console.warn('MongoDB health check failed:', error.message);
        this.isConnected = false;
        // Attempt reconnect
        if (!this.isShuttingDown) {
          this.reconnect();
        }
      }
    }, 30000);
  }

  /**
   * Reconnect if connection lost
   */
  async reconnect() {
    if (!this.isConnected && !this.isShuttingDown) {
      console.log('Attempting to reconnect to MongoDB...');

      // Clear any existing reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      try {
        // Reset connection state
        if (this.client) {
          try {
            await this.client.close();
          } catch (err) {
            // Ignore close errors
          }
          this.client = null;
        }

        this.db = null;
        this.retryCount = 0;

        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error.message);
        // Schedule another retry
        if (!this.isShuttingDown) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnect();
          }, 10000);
        }
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
      isShuttingDown: this.isShuttingDown
    };
  }

  /**
   * Execute transaction with retry
   */
  async withTransaction(callback) {
    if (!this.isConnected || !this.client) {
      throw new Error('Database not connected');
    }

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
    this.isShuttingDown = true;

    // Clear all timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      console.log('Closing MongoDB connection...');
      try {
        await this.client.close();
        this.isConnected = false;
        this.db = null;
        console.log('MongoDB connection closed');
      } catch (error) {
        console.error('Error closing MongoDB connection:', error.message);
      }
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
      console.warn(`Cannot get stats for ${name}:`, error.message);
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

  /**
   * Check if database is ready
   */
  isReady() {
    return this.isConnected && this.db !== null;
  }

  /**
   * Ping database to check connection
   */
  async ping() {
    if (!this.isConnected || !this.db) {
      return false;
    }
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
const dbInstance = new Database();

module.exports = {
  connectDB: () => dbInstance.connect(),
  getDB: () => dbInstance.getDB(),
  getClient: () => dbInstance.getClient(),
  closeDB: () => dbInstance.close(),
  isDBReady: () => dbInstance.isReady(),
  pingDB: () => dbInstance.ping(),
  db: dbInstance,
  Database
};