# ToyHub

ToyHub is a fully functional e-commerce platform designed to sell toys online. This project is built using the MERN stack (MongoDB, Express, React, Node.js) with a focus on creating a comprehensive platform for both users and administrators. It includes features such as user authentication, product management, and a responsive user interface.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Usage](#usage)
- [Technologies Used](#technologies-used)
- [API Documentation](#api-documentation)
- [License](#license)

## Features

### Admin Side
- Admin sign in
- User management (list, block/unblock users)
- Category management (add, edit, delete categories)
- Product management (add, edit, delete products)
- Multiple product images with cropping and resizing before upload

### User Side
- Home page with product listings
- User sign up & login with validation
- Sign up with OTP verification and timer
- Social login (Google, Facebook, etc.)
- Product details view with image zoom
- Product detailed page includes:
  - Breadcrumbs
  - Ratings
  - Price
  - Discounts or coupons applied
  - Reviews
  - Stock status
  - Product highlights/specifications
  - Related product recommendations

## Project Structure
TOYHUB<br>
│<br>
├── config<br>
│<br>
├── controllers<br>
│<br>
├── middlewares<br>
│<br>
├── models<br>
│<br>
├── node_modules<br>
│<br>
├── public<br>
│   ├── css<br>
│   ├── images<br>
│   └── js<br>
│<br>
├── routes<br>
│   └── admin.js<br>
│<br>
├── services<br>
│<br>
├── tests<br>
│   ├── integration<br>
│   │   └── auth.test.js<br>
│   └── unit<br>
│       ├── product.test.js<br>
│       └── user.test.js<br>
│<br>
├── utils<br>
│<br>
└── views<br>
    ├── auth<br>
    │   ├── login.ejs<br>
    │   └── signup.ejs<br>
    │<br>
    ├── layouts<br>
    │   └── main.ejs<br>
    │<br>
    ├── partials<br>
    │   ├── footer.ejs<br>
    │   └── header.ejs<br>
    │<br>
    └── products<br>
        ├── productDetails.ejs<br>
        └── index.ejs

------------------------------
  1. Clone the repository:
     ```bash
     git clone https://github.com/yourusername/toyhub.git
  2. Navigate to the project directory:
  3. Install the required dependencies:
  4. Set up environment variables:
   - Create a `.env` file in the root directory.
   - Add the following environment variables:
  5. Start the development server:
  6. Access the application:
   Open your web browser and go to http://localhost:3000 to view the ToyHub platform.
