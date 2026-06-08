const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Database connection pool - OPTIMIZED for Render free tier
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  query_timeout: 5000,
});

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        name VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        total_spent INTEGER DEFAULT 0,
        total_orders INTEGER DEFAULT 0,
        is_admin BOOLEAN DEFAULT FALSE,
        avatar TEXT,
        birth_year INTEGER,
        loyalty_points INTEGER DEFAULT 0
      );
    `);

    // Create products table with VARIANTS (no price, stock, capacity columns)
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        badge VARCHAR(50),
        image TEXT,
        description TEXT,
        variants JSONB NOT NULL DEFAULT '[{"size":"750ml","price":0,"discount":0}]',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add description column if missing (for existing tables)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='description') THEN
          ALTER TABLE products ADD COLUMN description TEXT;
        END IF;
      END $$;
    `);

    // Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(50) UNIQUE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        customer_name VARCHAR(100) NOT NULL,
        customer_email VARCHAR(255),
        phone VARCHAR(20) NOT NULL,
        address TEXT NOT NULL,
        notes TEXT,
        subtotal INTEGER NOT NULL,
        delivery INTEGER NOT NULL,
        total INTEGER NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create order_items table with size column
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER,
        product_name VARCHAR(200) NOT NULL,
        size VARCHAR(10) DEFAULT '750ml',
        quantity INTEGER NOT NULL,
        price INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create settings table for delivery settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);`);

    // Insert default admin user if not exists
    const adminCheck = await client.query(`SELECT * FROM users WHERE email = 'admin@liquorbelle.co.ke'`);
    if (adminCheck.rows.length === 0) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      await client.query(`
        INSERT INTO users (email, password, name, is_admin, created_at)
        VALUES ('admin@liquorbelle.co.ke', $1, 'Admin', TRUE, NOW())
      `, [adminPassword]);
      console.log('✅ Admin user created');
    }

    // Migrate existing products to variants format if needed
    const hasOldColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'price'
    `);
    
    if (hasOldColumns.rows.length > 0) {
      console.log('🔄 Migrating existing products to variants format...');
      
      // Get products that still have price column and no variants
      const oldProducts = await client.query(`
        SELECT id, name, capacity, price, category, badge, image, stock 
        FROM products 
        WHERE variants IS NULL OR variants = '[]'::jsonb
      `);
      
      for (const p of oldProducts.rows) {
        const variants = [{
          size: p.capacity || '750ml',
          price: p.price || 0,
          discount: 0
        }];
        
        await client.query(`
          UPDATE products 
          SET variants = $1, 
              description = COALESCE(description, 'Premium quality spirits from official distributors'),
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(variants), p.id]);
      }
      
      // Drop old columns after migration
      try {
        await client.query(`ALTER TABLE products DROP COLUMN IF EXISTS price`);
        await client.query(`ALTER TABLE products DROP COLUMN IF EXISTS capacity`);
        await client.query(`ALTER TABLE products DROP COLUMN IF EXISTS stock`);
        console.log('✅ Migrated products to variants format, removed old columns');
      } catch (err) {
        console.log('Note: Could not drop columns, but migration completed');
      }
    }

    // Check if products table is empty before seeding with new format
    const productCount = await client.query(`SELECT COUNT(*) FROM products`);
    if (parseInt(productCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO products (name, category, badge, image, description, variants) VALUES
        ('Johnnie Walker Black Label', 'whisky', 'hot', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Smooth, complex, and rich with notes of vanilla and honey.', '[{"size":"750ml","price":3500,"discount":0}]'),
        ('Jameson Irish Whiskey', 'whisky', NULL, 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Smooth triple-distilled Irish whiskey with hints of sherry and vanilla.', '[{"size":"750ml","price":3200,"discount":0}]'),
        ('Jack Daniels Old No.7', 'whisky', 'hot', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Classic Tennessee whiskey with charcoal mellowing.', '[{"size":"750ml","price":3800,"discount":0}]'),
        ('Chivas Regal 12', 'whisky', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Deluxe blended Scotch whisky with rich honey and pear notes.', '[{"size":"750ml","price":4200,"discount":0}]'),
        ('Hennessy VS', 'cognac', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'World-renowned cognac with fruity and spicy notes.', '[{"size":"750ml","price":5500,"discount":0}]'),
        ('Remy Martin VSOP', 'cognac', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Aged cognac with elegant floral and fruity aromas.', '[{"size":"750ml","price":6800,"discount":0}]'),
        ('Smirnoff Red', 'vodka', NULL, 'https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop', 'World\'s best-selling vodka, triple distilled for exceptional smoothness.', '[{"size":"750ml","price":1800,"discount":0}]'),
        ('Absolut Vodka', 'vodka', NULL, 'https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop', 'Premium Swedish vodka with rich grain character.', '[{"size":"750ml","price":2200,"discount":0}]'),
        ('Gilbeys Gin', 'gin', 'local', 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop', 'Classic London dry gin, locally bottled in Kenya.', '[{"size":"750ml","price":1400,"discount":0}]'),
        ('Bombay Sapphire', 'gin', NULL, 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop', 'Premium gin infused with 10 botanicals for a crisp taste.', '[{"size":"750ml","price":2900,"discount":0}]'),
        ('Kenya Cane', 'rum', 'local', 'https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop', 'Locally produced sugarcane rum, a Kenyan favorite.', '[{"size":"750ml","price":950,"discount":0}]'),
        ('Captain Morgan', 'rum', NULL, 'https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop', 'Spiced rum with notes of vanilla and caramel.', '[{"size":"750ml","price":2100,"discount":0}]'),
        ('Nederburg Rosé', 'wine', NULL, 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=300&h=300&fit=crop', 'Crisp South African rosé with berry notes.', '[{"size":"750ml","price":1500,"discount":0}]'),
        ('Jacobs Creek Moscato', 'wine', NULL, 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=300&h=300&fit=crop', 'Sweet and fruity Australian moscato.', '[{"size":"750ml","price":1300,"discount":0}]'),
        ('Tusker Lager', 'beer', 'local', 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop', 'Kenya\'s favorite premium lager.', '[{"size":"500ml","price":230,"discount":0}]'),
        ('Guinness Stout', 'beer', NULL, 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop', 'Rich dark Irish stout.', '[{"size":"500ml","price":350,"discount":0}]'),
        ('Moet & Chandon Brut', 'champagne', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 'Iconic French champagne for celebrations.', '[{"size":"750ml","price":9500,"discount":0}]'),
        ('Chrome Gin', 'gin', 'local', 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop', 'Premium Kenyan gin with unique botanical blend.', '[{"size":"250ml","price":600,"discount":0},{"size":"500ml","price":1100,"discount":0},{"size":"750ml","price":1650,"discount":0},{"size":"1L","price":2200,"discount":0}]');
      `);
      console.log('✅ Seeded products with variants to database');
    } else {
      console.log(`✅ Products table already has ${productCount.rows[0].count} products, skipping seed`);
    }

    console.log('✅ Database initialized successfully with variants support');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
  } finally {
    client.release();
  }
}

// ==================== AUTHENTICATION FUNCTIONS ====================
async function createUser(email, password, phone, name) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, phone, name, created_at, last_login) 
     VALUES ($1, $2, $3, $4, NOW(), NOW()) 
     RETURNING id, email, name, phone, created_at, is_admin`,
    [email, hashedPassword, phone, name]
  );
  return result.rows[0];
}

async function verifyUserPassword(email, password) {
  const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;
  return user;
}

async function getUserByEmail(email) {
  const result = await pool.query(`SELECT id, email, name, phone, created_at, last_login, is_admin FROM users WHERE email = $1`, [email]);
  return result.rows[0];
}

async function updateUserLastLogin(userId) {
  await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [userId]);
}

// ==================== ORDER FUNCTIONS ====================
async function createOrder(orderData, items) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const orderResult = await client.query(
      `INSERT INTO orders (order_number, user_id, customer_name, customer_email, phone, address, notes, subtotal, delivery, total, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING *`,
      [
        orderData.orderNumber,
        orderData.userId,
        orderData.customerName,
        orderData.customerEmail,
        orderData.phone,
        orderData.address,
        orderData.notes,
        orderData.subtotal,
        orderData.delivery,
        orderData.total,
        orderData.paymentMethod,
        orderData.status
      ]
    );
    
    const order = orderResult.rows[0];
    
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, size, quantity, price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.productId, item.name, item.size || '750ml', item.quantity, item.price]
      );
    }
    
    if (orderData.userId) {
      await client.query(
        `UPDATE users 
         SET total_spent = total_spent + $1, total_orders = total_orders + 1 
         WHERE id = $2`,
        [orderData.total, orderData.userId]
      );
    }
    
    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getOrdersByUser(userId) {
  const result = await pool.query(
    `SELECT o.*, 
      COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function getAllOrders() {
  const result = await pool.query(
    `SELECT o.*, 
      COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     GROUP BY o.id
     ORDER BY o.created_at DESC`
  );
  return result.rows;
}

async function getOrdersByEmail(email) {
  const result = await pool.query(
    `SELECT o.*, 
      COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.customer_email ILIKE $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [email]
  );
  return result.rows;
}

async function updateOrderStatus(orderId, status) {
  const result = await pool.query(
    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, orderId]
  );
  return result.rows[0];
}

async function getOrderById(orderId) {
  const result = await pool.query(
    `SELECT o.*, 
      COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.id = $1
     GROUP BY o.id`,
    [orderId]
  );
  return result.rows[0];
}

// ==================== PRODUCT FUNCTIONS WITH VARIANTS ====================
async function getAllProducts() {
  const result = await pool.query(`SELECT * FROM products ORDER BY id LIMIT 200`);
  return result.rows;
}

async function updateProduct(productId, productData) {
  const result = await pool.query(
    `UPDATE products 
     SET name = $1, category = $2, badge = $3, image = $4, description = $5, variants = $6, updated_at = NOW()
     WHERE id = $7
     RETURNING *`,
    [
      productData.name,
      productData.category,
      productData.badge,
      productData.image,
      productData.description,
      JSON.stringify(productData.variants || []),
      productId
    ]
  );
  return result.rows[0];
}

async function createProduct(productData) {
  const result = await pool.query(
    `INSERT INTO products (name, category, badge, image, description, variants, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [
      productData.name,
      productData.category,
      productData.badge,
      productData.image,
      productData.description,
      JSON.stringify(productData.variants || [])
    ]
  );
  return result.rows[0];
}

async function deleteProduct(productId) {
  const result = await pool.query(`DELETE FROM products WHERE id = $1 RETURNING *`, [productId]);
  return result.rows[0];
}

// ==================== STATS FUNCTIONS ====================
async function getDashboardStats() {
  const stats = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM orders) as total_orders,
      (SELECT COUNT(*) FROM products) as total_products,
      (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status = 'delivered') as total_revenue,
      (SELECT COUNT(*) FROM orders WHERE status = 'pending') as pending_orders
  `);
  return stats.rows[0];
}

// ==================== DELIVERY SETTINGS FUNCTIONS ====================
async function getDeliverySettings() {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'delivery'`);
  if (result.rows.length === 0) {
    return { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true };
  }
  return result.rows[0].value;
}

async function saveDeliverySettings(settings) {
  await pool.query(`
    INSERT INTO settings (key, value) 
    VALUES ('delivery', $1) 
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
  `, [JSON.stringify(settings), JSON.stringify(settings)]);
}

module.exports = {
  pool,
  initDB,
  createUser,
  verifyUserPassword,
  getUserByEmail,
  updateUserLastLogin,
  createOrder,
  getOrdersByUser,
  getAllOrders,
  getOrdersByEmail,
  getOrderById,
  updateOrderStatus,
  getAllProducts,
  updateProduct,
  createProduct,
  deleteProduct,
  getDashboardStats,
  getDeliverySettings,
  saveDeliverySettings
};