import products from '../../models/product.models.js'

function getLandingPage(req,res){
    const popularProducts = [
        { name: "Toy Car", image: "/images/Cover/toy-car.png", category: "Action Toys", price: 15.99, oldPrice: 19.99, rating: 4.0, manufacturer: "ToyMakers" },
        { name: "Barbie Doll", image: "/images/Dolls & Accesories/-original-imagv3ruz3h63tpx.webp", category: "Dolls", price: 29.99, rating: 4.5, manufacturer: "BarbieCorp" },
        { name: "Toy Car", image: "/images/Cover/toy-car.png", category: "Action Toys", price: 15.99, oldPrice: 19.99, stock: 100, sold: 50 },
        { name: "Barbie Doll", image: "/images/Dolls & Accesories/-original-imagv3ruz3h63tpx.webp", category: "Dolls", price: 29.99, stock: 150, sold: 75 },
        { name: "Jigsaw Puzzle", image: "/images/Cover/jigsaw-puzzle.png", category: "Puzzles", price: 9.99, stock: 200, sold: 100 },
        { name: "Building Blocks", image: "/images/Cover/building-blocks.png", category: "Building Sets", price: 49.99, oldPrice: 59.99, stock: 120, sold: 60 },
        { name: "Teddy Bear", image: "/images/Cover/teddy-bear.png", category: "Soft Toys", price: 12.99, stock: 180, sold: 90 },
        { name: "Play Kitchen", image: "/images/Cover/play-kitchen.png", category: "Playsets", price: 69.99, oldPrice: 79.99, stock: 100, sold: 50 },
        { name: "Art Supplies", image: "/images/Cover/art-supplies.png", category: "Arts & Crafts", price: 19.99, stock: 150, sold: 75 },
        { name: "Board Game", image: "/images/Cover/board-game.png", category: "Games", price: 39.99, stock: 120, sold: 60 }
    ];
    const bestSellarProducts = [
    { name: "Toy Car", image: "/images/Cover/toy-car.png", category: "Action Toys", price: 15.99, oldPrice: 19.99, rating: 4.0, manufacturer: "ToyMakers",stock: 150, sold: 75 },
        { name: "Barbie Doll", image: "/images/Dolls & Accesories/-original-imagv3ruz3h63tpx.webp", category: "Dolls", price: 29.99, rating: 4.5, manufacturer: "BarbieCorp",stock: 150, sold: 75 },
        { name: "Toy Car", image: "/images/Cover/toy-car.png", category: "Action Toys", price: 15.99, oldPrice: 19.99, stock: 100, sold: 50 },
        { name: "Barbie Doll", image: "/images/Dolls & Accesories/-original-imagv3ruz3h63tpx.webp", category: "Dolls", price: 29.99, stock: 150, sold: 75 }
    ]
    let categories = [
    { name: "Action Toys", image: "/images/Cover/action-png.png", items: 20 }, // Updated path
    { name: "Dolls", image: "/images/Cover/dolls.png", items: 15 }, // Updated path
    { name: "Puzzles", image: "/images/Cover/puzzle.png ", items: 30 }, // Updated path
    { name: "Building Sets", image: "/images/Cover/building-blocks.png", items: 25 }, // Updated path
    { name: "Puzzles", image: "/images/Cover/puzzle.png ", items: 30 }, // Updated path
    { name: "Building Sets", image: "/images/Cover/building-blocks.png", items: 25 } // Updated path
    ]
    res.render('layouts/home',{popularProducts, bestSellarProducts,categories })
}

export default {getLandingPage}