const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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

    // Create products table - NO DROP, preserve existing data
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        capacity VARCHAR(20),
        price INTEGER NOT NULL,
        category VARCHAR(50),
        badge VARCHAR(50),
        image TEXT,
        stock INTEGER,
        featured BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add capacity column if missing (migration)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='capacity') THEN
          ALTER TABLE products ADD COLUMN capacity VARCHAR(20);
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

    // Create order_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(200) NOT NULL,
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

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`);

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

    // Check if products table is empty before seeding
    const productCount = await client.query(`SELECT COUNT(*) FROM products`);
    if (parseInt(productCount.rows[0].count) === 0) {
      // Insert 20 products with working images
      await client.query(`
        INSERT INTO products (name, capacity, price, category, badge, image, stock) VALUES
        -- WHISKY (5)
        ('Johnnie Walker Black Label', '750ml', 3500, 'whisky', 'hot', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Jameson Irish Whiskey', '750ml', 3200, 'whisky', NULL, 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Jack Daniels Old No.7', '750ml', 3800, 'whisky', 'hot', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Chivas Regal 12', '750ml', 4200, 'whisky', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Ballantine''s Finest', '750ml', 2800, 'whisky', NULL, 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        
        -- COGNAC / BRANDY (3)
        ('Hennessy VS', '750ml', 5500, 'cognac', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Rémy Martin VSOP', '750ml', 6800, 'cognac', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        ('Martell VS', '750ml', 5200, 'cognac', NULL, 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        
        -- VODKA (3)
        ('Smirnoff Red', '750ml', 1800, 'vodka', NULL, 'https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop', 1),
        ('Absolut Vodka', '750ml', 2200, 'vodka', NULL, 'https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop', 1),
        ('Ciroc Vodka', '750ml', 3500, 'vodka', 'prem', 'https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop', 1),
        
        -- GIN (2)
        ('Gilbeys Gin', '750ml', 1400, 'gin', 'local', 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop', 1),
        ('Bombay Sapphire', '750ml', 2900, 'gin', NULL, 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop', 1),
        
        -- RUM (2)
        ('Kenya Cane', '750ml', 950, 'rum', 'local', 'https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop', 1),
        ('Captain Morgan', '750ml', 2100, 'rum', NULL, 'https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop', 1),
        
        -- WINE (2)
        ('Nederburg Rosé', '750ml', 1500, 'wine', NULL, 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=300&h=300&fit=crop', 1),
        ('Jacobs Creek Moscato', '750ml', 1300, 'wine', NULL, 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=300&h=300&fit=crop', 1),
        
        -- BEER (2)
        ('Tusker Lager', '500ml', 230, 'beer', 'local', 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop', 1),
        ('Guinness Stout', '500ml', 350, 'beer', NULL, 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop', 1),
        
        -- CHAMPAGNE (1)
        ('Moet & Chandon Brut', '750ml', 9500, 'champagne', 'prem', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1),
        
        -- KENYAN SPIRITS (1)
        ('Kingfisher Whisky', '750ml', 1800, 'kenyan', 'local', 'https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop', 1);
      `);
      console.log('✅ Seeded 20 products to database');
    } else {
      console.log(`✅ Products table already has ${productCount.rows[0].count} products, skipping seed`);
    }

    console.log('✅ Database initialized successfully');
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
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.productId, item.name, item.quantity, item.price]
      );
      
      if (item.productId) {
        await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock IS NOT NULL`,
          [item.quantity, item.productId]
        );
      }
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
      COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') as items,
      u.email as user_email
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     LEFT JOIN users u ON o.user_id = u.id
     GROUP BY o.id, u.email
     ORDER BY o.created_at DESC`
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

// ==================== PRODUCT FUNCTIONS ====================
async function getAllProducts() {
  const result = await pool.query(`SELECT * FROM products ORDER BY id`);
  return result.rows;
}

async function updateProduct(productId, productData) {
  const result = await pool.query(
    `UPDATE products 
     SET name = $1, capacity = $2, price = $3, category = $4, badge = $5, image = $6, stock = $7, updated_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [
      productData.name,
      productData.capacity,
      productData.price,
      productData.category,
      productData.badge,
      productData.image,
      productData.stock,
      productId
    ]
  );
  return result.rows[0];
}

async function createProduct(productData) {
  const result = await pool.query(
    `INSERT INTO products (name, capacity, price, category, badge, image, stock, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      productData.name,
      productData.capacity,
      productData.price,
      productData.category,
      productData.badge,
      productData.image,
      productData.stock
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
  updateOrderStatus,
  getAllProducts,
  updateProduct,
  createProduct,
  deleteProduct,
  getDashboardStats
};